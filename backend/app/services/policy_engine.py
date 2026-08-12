"""Policy engine service: Rego parsing/validation, auto-compilation from visual rules, and live testcase evaluation."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)


def _rego_str(value: Any) -> str:
    """Return a safely-quoted, escaped Rego string literal for a Python value.

    Uses JSON encoding, which produces a double-quoted string with the same
    escaping rules Rego expects (\\, \", and control chars). Prevents a value
    containing a quote or backslash from generating invalid Rego or injecting
    policy code (G17)."""
    return json.dumps(str(value))


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
                lines.append(f'\tinput.action == {_rego_str(action)}')
            if target_id and scope == "instance":
                lines.append(f'\tinput.agent_id == {_rego_str(target_id)}')
            elif target_id and scope == "class":
                lines.append(f'\tinput.agent_kind == {_rego_str(target_id)}')
            lines.append("}")
            lines.append("")
        else:
            # All conditions of a rule are AND'd together inside a SINGLE rule
            # block (one `effect if { ... }`). Emitting a block per condition
            # would OR them — the bug that made the tester disagree with OPA.
            lines.append(f"{effect} if {{")
            if action and action != "*":
                lines.append(f'\tinput.action == {_rego_str(action)}')
            if target_id and scope == "instance":
                lines.append(f'\tinput.agent_id == {_rego_str(target_id)}')
            elif target_id and scope == "class":
                lines.append(f'\tinput.agent_kind == {_rego_str(target_id)}')

            for c_idx, cond in enumerate(conditions, 1):
                field = cond.get("field", "")
                op = cond.get("operator", "eq")
                val = cond.get("value", "")

                # Unique var per condition so multiple conditions don't collide
                # inside the shared block. Check both params (Gateway format)
                # and arguments (Testcase format).
                pv = f"param_val_{c_idx}"
                field_lit = _rego_str(field)
                lines.append(f'\t{pv} := object.get(object.get(input, "params", {{}}), {field_lit}, object.get(object.get(input, "arguments", {{}}), {field_lit}, null))')
                lines.append(f'\t{pv} != null')

                if op in ("eq", "=="):
                    if isinstance(val, bool):
                        lines.append(f"\t{pv} == {str(val).lower()}")
                    elif isinstance(val, (int, float)) or (isinstance(val, str) and val.replace('.', '', 1).isdigit()):
                        lines.append(f"\t{pv} == {val}")
                    else:
                        lines.append(f"\t{pv} == {_rego_str(val)}")
                elif op in ("ne", "!="):
                    if isinstance(val, bool):
                        lines.append(f"\t{pv} != {str(val).lower()}")
                    elif isinstance(val, (int, float)) or (isinstance(val, str) and val.replace('.', '', 1).isdigit()):
                        lines.append(f"\t{pv} != {val}")
                    else:
                        lines.append(f"\t{pv} != {_rego_str(val)}")
                elif op == "gt":
                    lines.append(f"\tto_number({pv}) > {val}")
                elif op == "gte":
                    lines.append(f"\tto_number({pv}) >= {val}")
                elif op == "lt":
                    lines.append(f"\tto_number({pv}) < {val}")
                elif op == "lte":
                    lines.append(f"\tto_number({pv}) <= {val}")
                elif op == "contains":
                    lines.append(f'\tcontains(sprintf("%v", [{pv}]), {_rego_str(val)})')
                elif op == "regex_deny":
                    lines.append(f'\tregex.match({_rego_str(val)}, sprintf("%v", [{pv}]))')
                elif op == "regex_allow":
                    lines.append(f'\tnot regex.match({_rego_str(val)}, sprintf("%v", [{pv}]))')
                elif op == "in_list":
                    list_str = json.dumps(val if isinstance(val, list) else [str(val)])
                    lines.append(f"\t{pv} in {list_str}")
                elif op in ("outside_hours", "outside_business_hours"):
                    parts = str(val).split("-") if "-" in str(val) else ["09:00", "17:00"]
                    s_h, s_m = map(int, parts[0].strip().split(":")) if ":" in parts[0] else (9, 0)
                    e_h, e_m = map(int, parts[1].strip().split(":")) if ":" in parts[1] else (17, 0)
                    s_total = s_h * 60 + s_m
                    e_total = e_h * 60 + e_m
                    lines.append(f'\tns_{c_idx} := time.now_ns()')
                    lines.append(f'\tclock_{c_idx} := time.clock(ns_{c_idx})')
                    lines.append(f'\tmin_{c_idx} := (clock_{c_idx}[0] * 60) + clock_{c_idx}[1]')
                    lines.append(f'\t(min_{c_idx} < {s_total}) or (min_{c_idx} > {e_total})')

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

    # 2. Subprocess check via 'opa parse' (writes to a temp file — this OPA
    # version does not read policy from stdin / '-').
    import tempfile
    import os

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile("w", suffix=".rego", delete=False) as f:
            f.write(rego_source)
            tmp_path = f.name
        try:
            proc = await asyncio.create_subprocess_exec(
                "opa", "parse", tmp_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()
            if proc.returncode == 0:
                return True, []
            else:
                err_msg = stderr.decode().strip() or stdout.decode().strip()
                return False, [f"Rego Syntax Error: {err_msg}"]
        except FileNotFoundError:
            pass
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
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
    """Evaluate candidate Rego (or auto-compiled visual rules) against a test
    input using the REAL OPA engine (`opa eval`), so the "test my policy"
    result matches what the gateway's embedded OPA will actually decide.

    No Python-side re-implementation of Rego semantics: the decision comes
    entirely from OPA, queried at `data.agp.authz` (the platform's policy
    package), applying the same rule as the gateway — an explicit deny wins,
    otherwise allow follows the policy's `allow` value (default-deny)."""
    if not rego_source and visual_rules:
        rego_source = visual_rules_to_rego(visual_rules)

    rego_source = rego_source or "package agp.authz\n\ndefault allow := true\ndefault deny := false"

    # Validate syntax first so we can surface clean parse errors to the UI.
    valid, syntax_errors = await validate_rego(rego_source)
    if not valid:
        return {
            "allowed": False,
            "decision": "DENY",
            "reasons": [f"Policy Syntax Error: {e}" for e in syntax_errors],
            "rego_source": rego_source,
        }

    # Build the OPA input. The gateway passes tool arguments under `params`;
    # visual-rule policies also read `arguments`. Mirror one into the other so
    # both hand-written and auto-compiled policies see the values.
    opa_input = dict(input_payload)
    args = opa_input.get("arguments")
    if not isinstance(args, dict):
        args = {}
    params = opa_input.get("params")
    if not isinstance(params, dict):
        params = {}
    merged = {**args, **params}
    opa_input["arguments"] = merged
    opa_input["params"] = merged

    result_doc, err = await _opa_eval(rego_source, opa_input, "data.agp.authz")
    if err is not None:
        return {
            "allowed": False,
            "decision": "DENY",
            "reasons": [f"Policy evaluation error: {err}"],
            "rego_source": rego_source,
        }

    # Apply the gateway's decision semantics (see authz/engine.go Evaluate).
    deny = bool(result_doc.get("deny")) if isinstance(result_doc, dict) else False
    allow_val = result_doc.get("allow") if isinstance(result_doc, dict) else None
    reason = result_doc.get("reason") if isinstance(result_doc, dict) else None

    if deny:
        allowed = False
    elif isinstance(allow_val, bool):
        allowed = allow_val
    else:
        # Policy defined no applicable allow rule for this input → default-deny,
        # matching the gateway aggregator's `default allow := false`.
        allowed = False

    if not reason:
        if allowed:
            reason = "allowed by policy"
        elif deny:
            reason = "denied by an explicit deny rule"
        else:
            reason = "denied by policy (no matching allow rule)"

    return {
        "allowed": allowed,
        "decision": "ALLOW" if allowed else "DENY",
        "reasons": [reason],
        "rego_source": rego_source,
    }


async def _opa_eval(
    rego_source: str,
    input_payload: dict[str, Any],
    query: str,
) -> tuple[dict[str, Any] | None, str | None]:
    """Run `opa eval` against the given policy + input, returning the value of
    `query` as a dict (or None + an error string on failure)."""
    import tempfile
    import os

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile("w", suffix=".rego", delete=False) as f:
            f.write(rego_source)
            tmp_path = f.name

        try:
            proc = await asyncio.create_subprocess_exec(
                "opa", "eval", "--format", "json", "--fail-defined",
                "--stdin-input", "--data", tmp_path, query,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except FileNotFoundError:
            return None, "OPA binary not available in this environment"

        stdout, stderr = await proc.communicate(input=json.dumps(input_payload).encode())

        # --fail-defined exits non-zero (1) when the query IS defined; that's
        # normal here. A genuine error surfaces on stderr with exit code >1.
        if stderr and proc.returncode not in (0, 1):
            return None, stderr.decode().strip() or "opa eval failed"

        raw = stdout.decode().strip()
        if not raw:
            return {}, None

        parsed = json.loads(raw)
        results = parsed.get("result", [])
        if not results:
            return {}, None
        exprs = results[0].get("expressions", [])
        if not exprs:
            return {}, None
        value = exprs[0].get("value")
        return (value if isinstance(value, dict) else {}), None
    except Exception as e:
        logger.warning("opa eval failed: %r", e)
        return None, str(e)
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

