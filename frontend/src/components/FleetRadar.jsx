import React, { useMemo, useEffect, useState } from 'react';

const statusColor = {
  active: '#3ddc84',
  revoked: '#f5a623',
  killed: '#f85149',
};

export function FleetRadar({ instances, classes, size = 300 }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 50);
    return () => clearInterval(interval);
  }, []);

  const nodes = useMemo(() => {
    const classMap = new Map(classes.map(c => [c.id, c.name]));
    const byClass = new Map();
    for (const inst of instances) {
      const arr = byClass.get(inst.class) ?? [];
      arr.push(inst);
      byClass.set(inst.class, arr);
    }
    
    const classIds = Array.from(byClass.keys());
    const result = [];
    classIds.forEach((classId, classIdx) => {
      const group = byClass.get(classId);
      const orbitRadius = 45 + classIdx * 35;
      group.forEach((inst, i) => {
        const baseAngle = (i / group.length) * Math.PI * 2;
        const jitter = Math.sin(i * 7.3 + classIdx * 3.1) * 0.15;
        result.push({
          id: inst.id,
          classId,
          className: classMap.get(classId) ?? classId,
          status: inst.status,
          angle: baseAngle + jitter,
          radius: orbitRadius,
          pulsePhase: (i * 0.37 + classIdx * 0.21) % (Math.PI * 2),
        });
      });
    });
    return result;
  }, [instances, classes]);

  const center = size / 2;
  const maxRadius = Math.max(...nodes.map(n => n.radius), 80) + 20;
  const scale = (size / 2 - 20) / maxRadius;

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, margin: '0 auto' }}>
      <svg width={size} height={size} style={{ overflow: 'visible' }}>
        {/* Concentric orbit rings */}
        {Array.from(new Set(nodes.map(n => n.radius))).map((r, i) => (
          <circle key={i} cx={center} cy={center} r={r * scale} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={1} strokeDasharray="2 4" />
        ))}

        {/* Cross hairs */}
        <line x1={center} y1={0} x2={center} y2={size} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />
        <line x1={0} y1={center} x2={size} y2={center} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />

        {/* Center hub */}
        <circle cx={center} cy={center} r={6} fill="#4c8dff" opacity={0.15} />
        <circle cx={center} cy={center} r={3} fill="#4c8dff" />
        <text x={center} y={center + 22} textAnchor="middle" fill="#8b949e" fontSize={9} letterSpacing={1} fontFamily="JetBrains Mono, monospace">
          FLEET
        </text>

        {/* Radar sweep */}
        <g style={{ transformOrigin: 'center', animation: 'radar-sweep 4s linear infinite' }}>
          <defs>
            <linearGradient id="sweep-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#4c8dff" stopOpacity={0} />
              <stop offset="100%" stopColor="#4c8dff" stopOpacity={0.15} />
            </linearGradient>
          </defs>
          <path
            d={`M ${center} ${center} L ${center} ${center - maxRadius * scale} A ${maxRadius * scale} ${maxRadius * scale} 0 0 1 ${center + maxRadius * scale * Math.sin(0.6)} ${center - maxRadius * scale * Math.cos(0.6)} Z`}
            fill="url(#sweep-grad)"
          />
        </g>
        <style>{`@keyframes radar-sweep { to { transform: rotate(360deg); } }`}</style>

        {/* Nodes */}
        {nodes.map(node => {
          const x = center + Math.cos(node.angle - Math.PI / 2) * node.radius * scale;
          const y = center + Math.sin(node.angle - Math.PI / 2) * node.radius * scale;
          const color = statusColor[node.status] || '#8b949e';
          const pulse = 0.7 + 0.3 * Math.sin(tick * 0.05 + node.pulsePhase * 6);
          const nodeRadius = node.status === 'killed' ? 2 : 3.5;

          return (
            <g key={node.id} style={{ cursor: 'pointer' }}>
              {/* Pulse halo for active nodes */}
              {node.status === 'active' && (
                <circle cx={x} cy={y} r={nodeRadius + 4} fill={color} opacity={pulse * 0.25} />
              )}
              <circle cx={x} cy={y} r={nodeRadius} fill={color} opacity={node.status === 'killed' ? 0.5 : 0.9} />
              <circle cx={x} cy={y} r={nodeRadius + 1.5} fill="none" stroke={color} strokeWidth={0.5} opacity={0.4} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
