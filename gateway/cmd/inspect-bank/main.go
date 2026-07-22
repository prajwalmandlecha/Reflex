package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
)

var servers = map[string]string{
	"bank-identity":  "http://20.2.83.126:31100/mcp",
	"bank-payments":  "http://20.2.83.126:31200/mcp",
	"bank-financial": "http://20.2.83.126:31300/mcp",
	"bank-risk":      "http://20.2.83.126:31400/mcp",
}

func main() {
	for name, url := range servers {
		fmt.Printf("=====================================================\n")
		fmt.Printf(" SERVER: %s (%s)\n", name, url)
		fmt.Printf("=====================================================\n")

		jar, _ := cookiejar.New(nil)
		client := &http.Client{Jar: jar}

		// 1. Initialize
		initBody, _ := json.Marshal(map[string]any{
			"jsonrpc": "2.0",
			"id":      1,
			"method":  "initialize",
			"params": map[string]any{
				"protocolVersion": "2024-11-05",
				"capabilities":    map[string]any{},
				"clientInfo":      map[string]any{"name": "inspector", "version": "1.0"},
			},
		})

		req, _ := http.NewRequest("POST", url, bytes.NewReader(initBody))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json, text/event-stream")

		resp, err := client.Do(req)
		if err != nil {
			fmt.Printf("Error initializing %s: %v\n", name, err)
			continue
		}
		sessionID := resp.Header.Get("Mcp-Session-Id")
		resp.Body.Close()

		// Handshake complete notification
		notifBody, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "method": "notifications/initialized"})
		notifReq, _ := http.NewRequest("POST", url, bytes.NewReader(notifBody))
		notifReq.Header.Set("Content-Type", "application/json")
		notifReq.Header.Set("Accept", "application/json, text/event-stream")
		if sessionID != "" {
			notifReq.Header.Set("Mcp-Session-Id", sessionID)
		}
		if nResp, err := client.Do(notifReq); err == nil {
			nResp.Body.Close()
		}

		// 2. tools/list
		listBody, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": map[string]any{}})
		listReq, _ := http.NewRequest("POST", url, bytes.NewReader(listBody))
		listReq.Header.Set("Content-Type", "application/json")
		listReq.Header.Set("Accept", "application/json, text/event-stream")
		if sessionID != "" {
			listReq.Header.Set("Mcp-Session-Id", sessionID)
		}

		lResp, err := client.Do(listReq)
		if err != nil {
			fmt.Printf("Error listing tools %s: %v\n", name, err)
			continue
		}
		bodyBytes, _ := io.ReadAll(lResp.Body)
		lResp.Body.Close()

		fmt.Printf("Tools Response:\n%s\n\n", string(bodyBytes))
	}
}
