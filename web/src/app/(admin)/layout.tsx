import type { ReactNode } from 'react';
import { AdminShell } from '@/components/admin/AdminShell';

/** Route group layout: every /admin/* screen inherits the claim/2FA/idle guard. */
export default function AdminGroupLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
