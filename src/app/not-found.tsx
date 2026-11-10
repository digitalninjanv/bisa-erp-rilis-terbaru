import { NotFoundCard } from "@/components/blocks/not-found-card";

/**
 * A-25 U0 (POLA-11): 404 akar untuk URL yang tidak cocok dengan rute
 * mana pun di luar segmen /app.
 */
export default function RootNotFound() {
  return <NotFoundCard homeHref="/app" />;
}
