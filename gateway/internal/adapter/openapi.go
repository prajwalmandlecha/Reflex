// Package adapter converts OpenAPI specifications to MCP tool schemas and REST requests.
package adapter

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/getkin/kin-openapi/openapi3"
)

// MCPTool represents an MCP tool definition.
type MCPTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

// LoadSpec parses raw JSON or YAML OpenAPI spec bytes into a kin-openapi document.
func LoadSpec(data []byte) (*openapi3.T, error) {
	loader := openapi3.NewLoader()
	return loader.LoadFromData(data)
}

// SpecToMCPTools iterates an OpenAPI specification and extracts all operations as MCP tool schemas.
func SpecToMCPTools(doc *openapi3.T) ([]MCPTool, error) {
	var tools []MCPTool

	if doc == nil || doc.Paths == nil {
		return tools, nil
	}

	for path, pathItem := range doc.Paths.Map() {
		if pathItem == nil {
			continue
		}

		operations := map[string]*openapi3.Operation{
			"GET":    pathItem.Get,
			"POST":   pathItem.Post,
			"PUT":    pathItem.Put,
			"DELETE": pathItem.Delete,
			"PATCH":  pathItem.Patch,
		}

		for method, op := range operations {
			if op == nil {
				continue
			}

			toolName := op.OperationID
			if toolName == "" {
				// Fallback tool name if operationId is omitted in spec
				cleanPath := strings.ReplaceAll(strings.Trim(path, "/"), "/", "_")
				cleanPath = strings.ReplaceAll(cleanPath, "{", "")
				cleanPath = strings.ReplaceAll(cleanPath, "}", "")
				toolName = strings.ToLower(method) + "_" + cleanPath
			}

			desc := op.Summary
			if desc == "" {
				desc = op.Description
			}
			if desc == "" {
				desc = fmt.Sprintf("%s %s endpoint", method, path)
			}

			inputSchema := buildInputSchema(op)

			tools = append(tools, MCPTool{
				Name:        toolName,
				Description: desc,
				InputSchema: inputSchema,
			})
		}
	}

	return tools, nil
}

// extractSchema converts openapi3.Schema into a JSON Schema map preserving enum, items, default, bounds, format.
func extractSchema(s *openapi3.Schema) map[string]any {
	if s == nil {
		return map[string]any{"type": "string"}
	}
	m := make(map[string]any)
	if s.Type != nil {
		types := s.Type.Slice()
		if len(types) > 0 {
			m["type"] = types[0]
		}
	}
	if m["type"] == nil {
		m["type"] = "string"
	}
	if s.Description != "" {
		m["description"] = s.Description
	}
	if s.Default != nil {
		m["default"] = s.Default
	}
	if len(s.Enum) > 0 {
		m["enum"] = s.Enum
	}
	if s.Format != "" {
		m["format"] = s.Format
	}
	if s.Min != nil {
		m["minimum"] = *s.Min
	}
	if s.Max != nil {
		m["maximum"] = *s.Max
	}
	if s.Pattern != "" {
		m["pattern"] = s.Pattern
	}
	if m["type"] == "array" && s.Items != nil && s.Items.Value != nil {
		m["items"] = extractSchema(s.Items.Value)
	}
	return m
}

// buildInputSchema constructs JSON Schema properties for path parameters, query parameters, and request body.
func buildInputSchema(op *openapi3.Operation) map[string]any {
	properties := make(map[string]any)
	var required []string

	// 1. Process Parameters (Path, Query, Header, Cookie)
	for _, paramRef := range op.Parameters {
		if paramRef == nil || paramRef.Value == nil {
			continue
		}
		p := paramRef.Value
		var paramSchema map[string]any
		if p.Schema != nil && p.Schema.Value != nil {
			paramSchema = extractSchema(p.Schema.Value)
		} else {
			paramSchema = map[string]any{"type": "string"}
		}
		if p.Description != "" {
			paramSchema["description"] = p.Description
		}
		properties[p.Name] = paramSchema
		if p.Required {
			required = append(required, p.Name)
		}
	}

	// 2. Process Request Body (application/json)
	if op.RequestBody != nil && op.RequestBody.Value != nil {
		content := op.RequestBody.Value.Content
		if jsonMedia, ok := content["application/json"]; ok && jsonMedia.Schema != nil && jsonMedia.Schema.Value != nil {
			schemaVal := jsonMedia.Schema.Value
			for propName, propRef := range schemaVal.Properties {
				if propRef == nil || propRef.Value == nil {
					continue
				}
				pVal := propRef.Value
				propSchema := extractSchema(pVal)
				if pVal.Description != "" {
					propSchema["description"] = pVal.Description
				}
				properties[propName] = propSchema
			}
			required = append(required, schemaVal.Required...)
		}
	}

	schema := map[string]any{
		"type":       "object",
		"properties": properties,
	}
	if len(required) > 0 {
		schema["required"] = required
	}

	return schema
}

// BuildRESTRequest translates an MCP tools/call invocation into an HTTP REST request.
func BuildRESTRequest(baseURL string, doc *openapi3.T, toolName string, args map[string]any) (*http.Request, error) {
	if doc == nil || doc.Paths == nil {
		return nil, fmt.Errorf("invalid openapi document")
	}

	var targetPath string
	var targetMethod string
	var targetOp *openapi3.Operation

	// Find operation by toolName / operationId
	for path, pathItem := range doc.Paths.Map() {
		if pathItem == nil {
			continue
		}
		operations := map[string]*openapi3.Operation{
			"GET":    pathItem.Get,
			"POST":   pathItem.Post,
			"PUT":    pathItem.Put,
			"DELETE": pathItem.Delete,
			"PATCH":  pathItem.Patch,
		}
		for method, op := range operations {
			if op == nil {
				continue
			}
			opID := op.OperationID
			if opID == "" {
				cleanPath := strings.ReplaceAll(strings.Trim(path, "/"), "/", "_")
				cleanPath = strings.ReplaceAll(cleanPath, "{", "")
				cleanPath = strings.ReplaceAll(cleanPath, "}", "")
				opID = strings.ToLower(method) + "_" + cleanPath
			}
			if opID == toolName {
				targetPath = path
				targetMethod = method
				targetOp = op
				break
			}
		}
		if targetOp != nil {
			break
		}
	}

	if targetOp == nil {
		return nil, fmt.Errorf("operation for tool '%s' not found in openapi spec", toolName)
	}

	// Substitute path parameters, collect query parameters, and collect header parameters
	finalPath := targetPath
	usedArgs := make(map[string]bool)
	queryParams := make(map[string]string)
	headerParams := make(map[string]string)

	// Helper to find arg with case-insensitive / snake_case flexibility
	findArg := func(name string) (any, string, bool) {
		if val, exists := args[name]; exists {
			return val, name, true
		}
		normTarget := strings.ToLower(strings.ReplaceAll(name, "-", "_"))
		for k, v := range args {
			if strings.ToLower(strings.ReplaceAll(k, "-", "_")) == normTarget {
				return v, k, true
			}
		}
		return nil, "", false
	}

	for _, paramRef := range targetOp.Parameters {
		if paramRef == nil || paramRef.Value == nil {
			continue
		}
		p := paramRef.Value
		val, matchedKey, exists := findArg(p.Name)
		if exists {
			usedArgs[matchedKey] = true
			valStr := fmt.Sprintf("%v", val)
			switch strings.ToLower(p.In) {
			case "path":
				// Path-escape so values containing '/', '?' or '%' don't break routing (G21).
				finalPath = strings.ReplaceAll(finalPath, "{"+p.Name+"}", url.PathEscape(valStr))
			case "query":
				queryParams[p.Name] = valStr
			case "header":
				headerParams[p.Name] = valStr
			case "cookie":
				// Cookie parameter
				headerParams["Cookie"] = fmt.Sprintf("%s=%s", p.Name, valStr)
			}
		}
	}

	// Also check for common idempotency key argument names if not already captured
	if _, hasIdem := headerParams["Idempotency-Key"]; !hasIdem {
		for _, keyName := range []string{"Idempotency-Key", "idempotency_key", "idempotencyKey", "X-Idempotency-Key", "idempotency"} {
			if val, exists := args[keyName]; exists && val != nil {
				usedArgs[keyName] = true
				headerParams["Idempotency-Key"] = fmt.Sprintf("%v", val)
				break
			}
		}
	}

	fullURL := strings.TrimRight(baseURL, "/") + finalPath
	if len(queryParams) > 0 {
		// Query-escape keys & values so '&', '=', spaces, '%' don't corrupt the query (G21).
		q := make([]string, 0, len(queryParams))
		for k, v := range queryParams {
			q = append(q, url.QueryEscape(k)+"="+url.QueryEscape(v))
		}
		fullURL += "?" + strings.Join(q, "&")
	}

	// Construct request body for POST/PUT/PATCH from remaining unused arguments
	var reqBody io.Reader
	if targetMethod == "POST" || targetMethod == "PUT" || targetMethod == "PATCH" {
		bodyData := make(map[string]any)
		for k, v := range args {
			if !usedArgs[k] {
				bodyData[k] = v
			}
		}
		if len(bodyData) > 0 {
			b, err := json.Marshal(bodyData)
			if err != nil {
				return nil, fmt.Errorf("failed to marshal REST request body: %w", err)
			}
			reqBody = bytes.NewReader(b)
		} else {
			// Supply clean empty JSON object for POST/PUT/PATCH to satisfy strict REST servers
			reqBody = bytes.NewReader([]byte("{}"))
		}
	}

	req, err := http.NewRequest(targetMethod, fullURL, reqBody)
	if err != nil {
		return nil, err
	}

	// Set content headers and any operation headers (like Idempotency-Key)
	for hKey, hVal := range headerParams {
		req.Header.Set(hKey, hVal)
	}

	if reqBody != nil && req.Header.Get("Content-Type") == "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if req.Header.Get("Accept") == "" {
		req.Header.Set("Accept", "application/json")
	}

	return req, nil
}

// RESTResponseToMCPResult converts an HTTP REST response into a standard MCP JSON-RPC call result object,
// preserving important REST headers (Location, X-Idempotent-Replay, Retry-After) and synthesizing
// informative JSON when body is empty.
func RESTResponseToMCPResult(resp *http.Response) map[string]any {
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	isError := resp.StatusCode >= 400

	meta := map[string]any{
		"http_status": resp.StatusCode,
	}

	for _, h := range []string{"Location", "X-Idempotent-Replay", "Retry-After", "ETag", "Content-Type", "RateLimit-Remaining", "RateLimit-Reset", "X-Request-Id"} {
		if v := resp.Header.Get(h); v != "" {
			meta[strings.ToLower(strings.ReplaceAll(h, "-", "_"))] = v
		}
	}

	bodyText := strings.TrimSpace(string(body))
	if bodyText == "" {
		if loc := resp.Header.Get("Location"); loc != "" {
			bodyText = fmt.Sprintf(`{"status":%d,"location":%q,"message":"Resource created or updated"}`, resp.StatusCode, loc)
		} else if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			bodyText = fmt.Sprintf(`{"status":%d,"success":true}`, resp.StatusCode)
		} else {
			bodyText = fmt.Sprintf(`{"status":%d,"error":%q}`, resp.StatusCode, http.StatusText(resp.StatusCode))
		}
	}

	return map[string]any{
		"content": []map[string]any{
			{
				"type": "text",
				"text": bodyText,
			},
		},
		"isError": isError,
		"_meta":   meta,
	}
}

