// Package killswitch provides real-time kill-switch checks via Redis.
package killswitch

import (
	"context"
	"fmt"

	"github.com/redis/go-redis/v9"
)

const (
	fleetKey    = "agp:kill:fleet"
	classKeyFmt = "agp:kill:class:%s"
	agentKeyFmt = "agp:kill:agent:%s"
)

// Result describes the outcome of a kill-switch check.
type Result struct {
	Killed bool
	Reason string
	Scope  string // "fleet", "class", or "agent"
}

// Switch checks kill-switch flags in Redis.
type Switch struct {
	rdb *redis.Client
}

// NewSwitch creates a kill-switch checker backed by Redis.
func NewSwitch(rdb *redis.Client) *Switch {
	return &Switch{rdb: rdb}
}

// Check returns whether fleet, class, or agent instance has been revoked/killed.
// Uses pipelining to issue all GETs in a single round-trip.
func (s *Switch) Check(ctx context.Context, agentID, classID string) (*Result, error) {
	pipe := s.rdb.Pipeline()
	fleetCmd := pipe.Get(ctx, fleetKey)
	var classCmd *redis.StringCmd
	if classID != "" {
		classCmd = pipe.Get(ctx, fmt.Sprintf(classKeyFmt, classID))
	}
	agentCmd := pipe.Get(ctx, fmt.Sprintf(agentKeyFmt, agentID))

	_, _ = pipe.Exec(ctx)

	// 1. Check fleet kill
	if val, err := fleetCmd.Result(); err == nil && val != "" {
		return &Result{Killed: true, Reason: "fleet-wide emergency stop active", Scope: "fleet"}, nil
	} else if err != nil && err != redis.Nil {
		return nil, fmt.Errorf("checking fleet kill switch: %w", err)
	}

	// 2. Check class kill
	if classCmd != nil {
		if val, err := classCmd.Result(); err == nil && val != "" {
			return &Result{Killed: true, Reason: fmt.Sprintf("agent class '%s' revoked", classID), Scope: "class"}, nil
		} else if err != nil && err != redis.Nil {
			return nil, fmt.Errorf("checking class kill switch: %w", err)
		}
	}

	// 3. Check agent kill
	if val, err := agentCmd.Result(); err == nil && val != "" {
		return &Result{Killed: true, Reason: fmt.Sprintf("agent '%s' revoked", agentID), Scope: "agent"}, nil
	} else if err != nil && err != redis.Nil {
		return nil, fmt.Errorf("checking agent kill switch: %w", err)
	}

	return &Result{Killed: false}, nil
}

// KillAgent sets the kill switch for a specific agent.
func (s *Switch) KillAgent(ctx context.Context, agentID string) error {
	return s.rdb.Set(ctx, fmt.Sprintf(agentKeyFmt, agentID), "1", 0).Err()
}

// ReviveAgent clears the kill switch for a specific agent.
func (s *Switch) ReviveAgent(ctx context.Context, agentID string) error {
	return s.rdb.Del(ctx, fmt.Sprintf(agentKeyFmt, agentID)).Err()
}

// HaltFleet sets the fleet-wide kill switch.
func (s *Switch) HaltFleet(ctx context.Context) error {
	return s.rdb.Set(ctx, fleetKey, "1", 0).Err()
}

// ResumeFleet clears the fleet-wide kill switch.
func (s *Switch) ResumeFleet(ctx context.Context) error {
	return s.rdb.Del(ctx, fleetKey).Err()
}
