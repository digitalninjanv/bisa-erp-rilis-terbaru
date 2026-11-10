import { NotFoundCard } from "@/components/blocks/not-found-card";

/**
 * A-25 U0 (POLA-11): 404 untuk segmen /app — dirender di dalam layout
 * segmen yang cocok (di dalam cangkang modul bila rute berada di bawah
 * modul, atau di bawah layout /app untuk rute /app yang tak dikenal).
 */
export default function AppNotFound() {
  return <NotFoundCard homeHref="/app" />;
}
