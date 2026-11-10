"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatIDR } from "@/lib/money";

/* FIX-R2 Tahap 2 (RD2U-06/14): palet grafik SELARAS dengan token
   --chart-1..5 di globals.css (nilai identik; Recharts membutuhkan
   warna literal untuk atribut SVG). Isian area kini rata beropasitas
   rendah — bukan gradasi, mengikuti larangan bahasa gradasi generik
   di AGENTS.md. Sumbu memakai 11px seperti teks sekunder lain. */
const CHART_TEAL = "#0e9384"; // --chart-2
const compactAmount = new Intl.NumberFormat("id-ID", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const COLORS = ["#0e9384", "#714b67", "#c28b36", "#5b6f91", "#9a5b4f", "#0d6b60"]; // --chart-2,1,3,4,5 + tone-teal

export function SalesTrendChart({
  data,
}: {
  data: { date: string; label?: string; total: number; transactions: number }[];
}) {
  const hasLabels = data.some((row) => row.label);
  return (
    <div className="h-[240px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey={hasLabels ? "label" : "date"}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickFormatter={
              hasLabels ? undefined : (value: string) => value.slice(8)
            }
            minTickGap={24}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickFormatter={(value: number) => compactAmount.format(value)}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          <Tooltip
            formatter={(value) => formatIDR(Number(value ?? 0))}
            labelFormatter={(value, payload) => {
              const row = payload?.[0]?.payload as { date?: string; label?: string } | undefined;
              return row?.label ?? `Tanggal ${row?.date ?? String(value ?? "")}`;
            }}
            contentStyle={{ fontSize: 11, borderRadius: 8, borderColor: "var(--border)" }}
          />
          <Area type="monotone" dataKey="total" stroke={CHART_TEAL} strokeWidth={2} fill={CHART_TEAL} fillOpacity={0.12} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PaymentChart({ data }: { data: { name: string; amount: number }[] }) {
  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickFormatter={(value: number) => compactAmount.format(value)}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            width={80}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip formatter={(value) => formatIDR(Number(value ?? 0))} contentStyle={{ fontSize: 11, borderRadius: 8, borderColor: "var(--border)" }} />
          <Bar dataKey="amount" radius={[0, 4, 4, 0]}>
            {data.map((_, index) => (
              <Cell key={index} fill={COLORS[index % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
