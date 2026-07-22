// mcpclient.go provides the outbound MCP client stub that simulates bank service responses.
//
// For the hackathon, this returns canned responses instead of connecting to real services.
// The authorization pipeline is the real demo, not the downstream integration.
package gateway

import (
	"fmt"
	"time"
)

// BankServiceResponse simulates a downstream bank service response.
type BankServiceResponse struct {
	Success       bool   `json:"success"`
	TransactionID string `json:"transaction_id,omitempty"`
	Message       string `json:"message"`
}

// SimulateBankCall returns a simulated bank service response based on the action.
func SimulateBankCall(action, resource string, amount float64) *BankServiceResponse {
	switch action {
	case "account.balance":
		return &BankServiceResponse{
			Success: true,
			Message: fmt.Sprintf("Balance for %s: $12,345.67", resource),
		}
	case "account.transactions":
		return &BankServiceResponse{
			Success: true,
			Message: fmt.Sprintf("Last 10 transactions for %s returned", resource),
		}
	case "account.details":
		return &BankServiceResponse{
			Success: true,
			Message: fmt.Sprintf("Account details for %s returned", resource),
		}
	case "payment.initiate":
		return &BankServiceResponse{
			Success:       true,
			TransactionID: fmt.Sprintf("PAY-%d", time.Now().UnixMilli()),
			Message:       fmt.Sprintf("Payment of $%.2f initiated", amount),
		}
	case "payment.status":
		return &BankServiceResponse{
			Success: true,
			Message: fmt.Sprintf("Payment %s: completed", resource),
		}
	case "trading.quote":
		return &BankServiceResponse{
			Success: true,
			Message: fmt.Sprintf("Quote for %s: $142.50 (bid) / $142.55 (ask)", resource),
		}
	case "trading.execute":
		return &BankServiceResponse{
			Success:       true,
			TransactionID: fmt.Sprintf("TRD-%d", time.Now().UnixMilli()),
			Message:       fmt.Sprintf("Trade executed: %s for $%.2f", resource, amount),
		}
	case "trading.positions":
		return &BankServiceResponse{
			Success: true,
			Message: "Current positions returned (3 open)",
		}
	default:
		return &BankServiceResponse{
			Success: false,
			Message: fmt.Sprintf("Unknown action: %s", action),
		}
	}
}
