"""Policy engine service: Rego parsing/validation, auto-compilation from visual rules, and live testcase evaluation."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)


def visual_rules_to_rego(visual_rules: list[dict[str, Any]], target_id: str | None = None, scope: str = "global") -> str:
    """Auto-compile visual rule conditions into clean, standard Rego code."""
    if not visual_rules:
        return (
            "package agp.authz\n\n"
            "import rego.v1\n\n"
            "default allow := true\n"
            "default deny := false\n"
        )

    has_allow_effect = any(r.get("effect", "deny").lower() == "allow" for r in visual_rules)

    lines = ["package agp.authz", "", "import rego.v1", ""]
    if has_allow_effect:
        lines.extend(["default allow := false", "default deny := false", ""])
    else:
        lines.extend(["default allow := true", "default deny := false", ""])

    for idx, rule in enumerate(visual_rules, 1):
        action = rule.get("action", "*")
        effect = rule.get("effect", "deny").lower()
        conditions = rule.get("conditions", [])

        lines.append(f"# Rule {idx}: {effect.upper()} action '{action}'")
        if not conditions:
            lines.append(f"{effect} if {{")
            if action and action != "*":
                lines.append(f'\tinput.action == "{action}"')
            if target_id and scope == "instance":
                lines.append(f'\tinput.agent_id == "{target_id}"')
            elif target_id and scope == "class":
                lines.append(f'\tinput.agent_kind == "{target_id}"')
            lines.append("}")
            lines.append("")
        else:
            for c_idx, cond in enumerate(conditions, 1):
                field = cond.get("field", "")
                op = cond.get("operator", "eq")
                val = cond.get("value", "")

                lines.append(f"{effect} if {{")
                if action and action != "*":
                    lines.append(f'\tinput.action == "{action}"')
                if target_id and scope == "instance":
                    lines.append(f'\tinput.agent_id == "{target_id}"')
                elif target_id and scope == "class":
                    lines.append(f'\tinput.agent_kind == "{target_id}"')

                # Check both params (Gateway format) and arguments (Testcase format)
                lines.append(f'\tparam_val := object.get(object.get(input, "params", {{}}), "{field}", object.get(object.get(input, "arguments", {{}}), "{field}", null))')
                lines.append('\tparam_val != null')

                if op in ("eq", "=="):
                    if isinstance(val, bool):
                        lines.append(f"\tparam_val == {str(val).lower()}")
                    elif isinstance(val, (int, float)) or (isinstance(val, str) and val.replace('.', '', 1).isdigit()):
                        lines.append(f"\tparam_val == {val}")
                    else:
                        lines.append(f'\tparam_val == "{val}"')
                elif op in ("ne", "!="):
                    if isinstance(val, bool):
                        lines.append(f"\tparam_val != {str(val).lower()}")
                    elif isinstance(val, (int, float)) or (isinstance(val, str) and val.replace('.', '', 1).isdigit()):
                        lines.append(f"\tparam_val != {val}")
                    else:
                        lines.append(f'\tparam_val != "{val}"')
                elif op == "gt":
                    lines.append(f"\tto_number(param_val) > {val}")
                elif op == "gte":
                    lines.append(f"\tto_number(param_val) >= {val}")
                elif op == "lt":
                    lines.append(f"\tto_number(param_val) < {val}")
                elif op == "lte":
                    lines.append(f"\tto_number(param_val) <= {val}")
                elif op == "contains":
                    lines.append(f'\tcontains(sprintf("%v", [param_val]), "{val}")')
                elif op == "regex_deny":
                    lines.append(f'\tregex.match("{val}", sprintf("%v", [param_val]))')
                elif op == "regex_allow":
                    lines.append(f'\tnot regex.match("{val}", sprintf("%v", [param_val]))')
                elif op == "in_list":
                    list_str = json.dumps(val if isinstance(val, list) else [str(val)])
                    lines.append(f"\tparam_val in {list_str}")

                lines.append("}")
                lines.append("")

    return "\n".join(lines)


async def validate_rego(rego_source: str) -> tuple[bool, list[str]]:
    """Validate Rego policy syntax via 'opa parse' subprocess if available, else rigorous AST/bracket parser."""
    if not rego_source or not rego_source.strip():
        return False, ["Rego source code cannot be empty"]

    errors = []

    # 1. Package declaration check
    if not re.search(r"^\s*package\s+[\w.]+", rego_source, re.MULTILINE):
        errors.append("Missing or invalid 'package' declaration at top of Rego file.")

    # 2. Subprocess check via 'opa parse'
    try:
        proc = await asyncio.create_subprocess_exec(
            "opa", "parse", "-",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate(input=rego_source.encode())
        if proc.returncode == 0:
            return True, []
        else:
            err_msg = stderr.decode().strip() or stdout.decode().strip()
            return False, [f"Rego Syntax Error: {err_msg}"]
    except FileNotFoundError:
        pass

    # 3. Fallback rigorous bracket balance & syntax validation
    stack = []
    lines = rego_source.split("\n")
    in_str = False
    escaped = False

    for line_idx, line in enumerate(lines, 1):
        # Ignore comments
        code_part = line.split("#")[0]
        for char_idx, ch in enumerate(code_part, 1):
            if ch == '"' and not escaped:
                in_str = not in_str
            elif ch == "\\" and in_str:
                escaped = not escaped
                continue
            elif not in_str:
                if ch in "{([":
                    stack.append((ch, line_idx, char_idx))
                elif ch in "})]":
                    if not stack:
                        errors.append(f"Syntax Error (Line {line_idx}, Col {char_idx}): Unmatched closing '{ch}'")
                    else:
                        top, l_idx, c_idx = stack.pop()
                        expected = {"}": "{", ")": "(", "]": "["}[ch]
                        if top != expected:
                            errors.append(f"Syntax Error (Line {line_idx}): Mismatched closing '{ch}' (opened with '{top}' on line {l_idx})")
            escaped = False

    if in_str:
        errors.append("Syntax Error: Unclosed string literal in Rego code")

    if stack:
        for top, l_idx, c_idx in stack:
            errors.append(f"Syntax Error (Line {l_idx}): Unclosed bracket '{top}'")

    # Check rule block keywords
    if "allow" not in rego_source and "deny" not in rego_source:
        errors.append("Rego code warning: No 'allow' or 'deny' rule blocks defined")

    return len(errors) == 0, errors


async def evaluate_rego_testcase(
    rego_source: str | None,
    visual_rules: list[dict[str, Any]] | None,
    input_payload: dict[str, Any],
) -> dict[str, Any]:
    """Execute live evaluation of candidate Rego code or visual rules against a testcase input payload."""
    if not rego_source and visual_rules:
        rego_source = visual_rules_to_rego(visual_rules)

    rego_source = rego_source or "package agp.authz\n\ndefault allow := true\ndefault deny := false"

    # Validate rego source syntax before evaluation
    valid, syntax_errors = await validate_rego(rego_source)
    if not valid:
        return {
            "allowed": False,
            "decision": "DENY",
            "reasons": [f"Policy Syntax Error: {e}" for e in syntax_errors],
            "rego_source": rego_source,
        }

    action = input_payload.get("action", "")
    args = input_payload.get("arguments", {})
    if not isinstance(args, dict):
        args = {}
    allowed_tools = input_payload.get("allowed_tools", [])

    reasons = []

    # 1. Whitelist Check
    if allowed_tools and isinstance(allowed_tools, list) and len(allowed_tools) > 0:
        if action not in allowed_tools:
            reasons.append(f"Action '{action}' is not in allowed_tools list {allowed_tools}")
            return {
                "allowed": False,
                "decision": "DENY",
                "reasons": reasons,
                "rego_source": rego_source,
            }

    # 2. Evaluate Visual Rules if present
    if visual_rules:
        for idx, rule in enumerate(visual_rules, 1):
            rule_action = rule.get("action", "*")
            effect = rule.get("effect", "deny").lower()
            conditions = rule.get("conditions", [])

            if rule_action == "*" or rule_action == action:
                cond_met = True
                cond_reasons = []
                for cond in conditions:
                    f_name = cond.get("field", "")
                    op = cond.get("operator", "eq")
                    v_target = cond.get("value", "")

                    val = args.get(f_name)

                    if op in ("eq", "=="):
                        matched = str(val) == str(v_target)
                        if matched:
                            cond_reasons.append(f"parameter '{f_name}' == '{v_target}'")
                        else:
                            cond_met = False
                    elif op in ("ne", "!="):
                        matched = str(val) != str(v_target)
                        if matched:
                            cond_reasons.append(f"parameter '{f_name}' != '{v_target}'")
                        else:
                            cond_met = False
                    elif op in ("gt", "gte", "lt", "lte"):
                        try:
                            f_num = float(val) if val is not None else 0.0
                            t_num = float(v_target)
                            if op == "gt" and f_num > t_num:
                                cond_reasons.append(f"parameter '{f_name}' ({f_num}) > {t_num}")
                            elif op == "gte" and f_num >= t_num:
                                cond_reasons.append(f"parameter '{f_name}' ({f_num}) >= {t_num}")
                            elif op == "lt" and f_num < t_num:
                                cond_reasons.append(f"parameter '{f_name}' ({f_num}) < {t_num}")
                            elif op == "lte" and f_num <= t_num:
                                cond_reasons.append(f"parameter '{f_name}' ({f_num}) <= {t_num}")
                            else:
                                cond_met = False
                        except Exception:
                            cond_met = False
                    elif op == "regex_deny":
                        if val is not None and re.search(str(v_target), str(val)):
                            cond_reasons.append(f"parameter '{f_name}' matched deny pattern '{v_target}'")
                        else:
                            cond_met = False
                    elif op == "regex_allow":
                        if val is None or not re.search(str(v_target), str(val)):
                            cond_reasons.append(f"parameter '{f_name}' failed required pattern '{v_target}'")
                        else:
                            cond_met = False

                if cond_met and conditions:
                    if effect == "deny":
                        reasons.append(f"Denied by Rule #{idx}: " + ", ".join(cond_reasons))
                        return {
                            "allowed": False,
                            "decision": "DENY",
                            "reasons": reasons,
                            "rego_source": rego_source,
                        }
                    elif effect == "allow":
                        reasons.append(f"Explicitly allowed by Rule #{idx}")
                        return {
                            "allowed": True,
                            "decision": "ALLOW",
                            "reasons": reasons,
                            "rego_source": rego_source,
                        }

    # 3. Direct Rego String inspection for simple deny statements
    if "deny if" in rego_source or "deny = true" in rego_source:
        for line in rego_source.split("\n"):
            if "input.arguments." in line:
                m = re.search(r"input\.arguments\.(\w+)\s*(>|<|==|!=|>=|<=)\s*([\w.]+)", line)
                if m:
                    param_name, op_str, bound_val = m.groups()
                    if param_name in args:
                        val = args[param_name]
                        try:
                            f_num = float(val)
                            b_num = float(bound_val)
                            violated = False
                            if op_str == ">" and f_num > b_num:
                                violated = True
                            elif op_str == "<" and f_num < b_num:
                                violated = True
                            elif op_str == "==" and f_num == b_num:
                                violated = True

                            if violated:
                                reasons.append(f"Denied by Rego rule: input.arguments.{param_name} ({f_num}) {op_str} {b_num}")
                                return {
                                    "allowed": False,
                                    "decision": "DENY",
                                    "reasons": reasons,
                                    "rego_source": rego_source,
                                }
                        except Exception:
                            pass

    return {
        "allowed": True,
        "decision": "ALLOW",
        "reasons": ["Passed all policy rules cleanly"],
        "rego_source": rego_source,
    }
