import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function MetricCard({ icon, iconColor, title, value, subtitle, gradientClass, className }) {
  return (
    <Card className={cn("bg-surface-container/40 backdrop-blur-xl border-outline-variant/20 hover:border-outline-variant/40 transition-colors group", className)}>
      <CardContent className="p-4 flex flex-col justify-between h-full">
        <div className="flex justify-between items-start mb-2">
          {typeof icon === 'string' ? (
            <span className={cn("material-symbols-outlined", iconColor)}>{icon}</span>
          ) : (
            icon
          )}
          <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", gradientClass)}>
            {title}
          </span>
        </div>
        <div>
          <div className="text-2xl font-bold font-headline-md tracking-tight">{value}</div>
          <div className="text-[11px] text-on-surface-variant font-medium uppercase tracking-wider">{subtitle}</div>
        </div>
      </CardContent>
    </Card>
  );
}
