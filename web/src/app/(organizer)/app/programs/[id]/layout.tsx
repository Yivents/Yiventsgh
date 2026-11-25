'use client';

import type { ReactNode } from 'react';
import { ProgramLayout } from '@/components/organizer/ProgramLayout';

export default function ProgramIdLayout({ children }: { children: ReactNode }) {
  return <ProgramLayout>{children}</ProgramLayout>;
}
