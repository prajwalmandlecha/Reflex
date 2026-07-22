// Package adapter converts OpenAPI specifications to MCP tool schemas and REST requests.
package adapter

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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

// buildInputSchema constructs JSON Schema properties for path parameters, query parameters, and request body.
func buildInputSchema(op *openapi3.Operation) map[string]any {
	properties := make(map[string]any)
	var required []string

	// 1. Process Parameters (Path & Query)
	for _, paramRef := range op.Parameters {
		if paramRef == nil || paramRef.Value == nil {
			continue
		}
		p := paramRef.Value
		paramSchema := map[string]any{
			"type":        "string",
			"description": p.Description,
		}
		if p.Schema != nil && p.Schema.Value != nil && p.Schema.Value.Type != nil {
			types := p.Schema.Value.Type.Slice()
			if len(types) > 0 {
				paramSchema["type"] = types[0]
			}
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
				pType := "string"
				if pVal.Type != nil {
					types := pVal.Type.Slice()
					if len(types) > 0 {
						pType = types[0]
					}
				}
				properties[propName] = map[string]any{
					"type":        pType,
					"description": pVal.Description,
				}
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

	// Substitute path parameters & collect query parameters
	finalPath := targetPath
	usedArgs := make(map[string]bool)
	queryParams := make(map[string]string)

	for _, paramRef := range targetOp.Parameters {
		if paramRef == nil || paramRef.Value == nil {
			continue
		}
		p := paramRef.Value
		val, exists := args[p.Name]
		if exists {
			usedArgs[p.Name] = true
			valStr := fmt.Sprintf("%v", val)
			if p.In == "path" {
				finalPath = strings.ReplaceAll(finalPath, "{"+p.Name+"}", valStr)
			} else if p.In == "query" {
				queryParams[p.Name] = valStr
			}
		}
	}

	fullURL := strings.TrimRight(baseURL, "/") + finalPath
	if len(queryParams) > 0 {
		var q []string
		for k, v := range queryParams {
			q = append(q, k+"="+v)
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
		}
	}

	req, err := http.NewRequest(targetMethod, fullURL, reqBody)
	if err != nil {
		return nil, err
	}

	if reqBody != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")

	return req, nil
}

// RESTResponseToMCPResult converts an HTTP REST response into a standard MCP JSON-RPC call result object.
func RESTResponseToMCPResult(resp *http.Response) map[string]any {
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	isError := resp.StatusCode >= 400

	return map[string]any{
		"content": []map[string]any{
			{
				"type": "text",
				"text": string(body),
			},
		},
		"isError": isError,
	}
}
