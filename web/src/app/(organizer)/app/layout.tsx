'use client';

import type { ReactNode } from 'react';
import { AppShell } from '@/components/organizer/AppShell';

export default function OrganizerAppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
