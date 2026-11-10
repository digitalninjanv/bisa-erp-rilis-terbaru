"use client";

import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

// SIM-2 S6 (SEC-02): adminClient & organizationClient dicabut bersama
// plugin servernya di src/lib/auth.ts — klien tidak pernah memanggil
// satu pun metode keduanya (hanya signIn.email & signOut yang dipakai).
export const authClient = createAuthClient({
  plugins: [twoFactorClient()],
});
