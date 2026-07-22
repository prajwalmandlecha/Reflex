// Package killswitch provides real-time kill-switch checks via Redis.
// Two flags are checked on every request: kill:fleet (global) and kill:agent:{id} (per-agent).
// Because every agent action already requires a live Redis read, there is no window
// where an in-flight check could be using stale data.
package killswitch

import (
	"context"
	"fmt"

	"github.com/redis/go-redis/v9"
)

const (
	fleetKey    = "kill:fleet"
	agentKeyFmt = "kill:agent:%s"
)

// Result describes the outcome of a kill-switch check.
type Result struct {
	Killed bool
	Reason string
}

// Switch checks kill-switch flags in Redis.
type Switch struct {
	rdb *redis.Client
}

// NewSwitch creates a kill-switch checker backed by the given Redis client.
func NewSwitch(rdb *redis.Client) *Switch {
	return &Switch{rdb: rdb}
}

// Check returns whether the fleet or this specific agent has been killed.
// Uses pipelining to issue both GETs in a single round-trip.
func (s *Switch) Check(ctx context.Context, agentID string) (*Result, error) {
	pipe := s.rdb.Pipeline()
	fleetCmd := pipe.Get(ctx, fleetKey)
	agentCmd := pipe.Get(ctx, fmt.Sprintf(agentKeyFmt, agentID))

	// Execute the pipeline — redis.Nil errors are expected for unset keys.
	_, _ = pipe.Exec(ctx)

	// Check fleet kill
	if fleetVal, err := fleetCmd.Result(); err == nil && fleetVal != "" {
		return &Result{Killed: true, Reason: "fleet-wide emergency stop active"}, nil
	} else if err != nil && err != redis.Nil {
		return nil, fmt.Errorf("checking fleet kill switch: %w", err)
	}

	// Check agent kill
	if agentVal, err := agentCmd.Result(); err == nil && agentVal != "" {
		return &Result{Killed: true, Reason: fmt.Sprintf("agent %s revoked", agentID)}, nil
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
