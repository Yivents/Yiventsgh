import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { doc, getDoc } from 'firebase-admin/firestore';
import { Badge, Card } from '@yivents/ui';
import { getAdminDb } from '@/lib/firebase/admin';
import { safeText } from '@/lib/format';
import { LEGAL_PAGES, LEGAL_SLUGS, type LegalPageContent } from '@/components/admin/legalContent';

/** SSR with hourly ISR; Firestore content wins, bundled plain text is the fallback. */
export const revalidate = 3600;

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return LEGAL_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = LEGAL_PAGES[slug];
  return { title: page?.title ?? 'Legal', description: page?.summary };
}

async function loadStored(slug: string): Promise<LegalPageContent | null> {
  try {
    // Admin SDK credentials are optional in local builds; failure falls back below.
    const snap = await getDoc(doc(getAdminDb(), 'contentPages', slug));
    if (!snap.exists()) return null;
    const data = snap.data();
    if (!data) return null;
    const title = typeof data.title === 'string' ? data.title : '';
    const body = typeof data.body === 'string' ? data.body : '';
    const summary = typeof data.summary === 'string' ? data.summary : '';
    return title && body ? { title, summary, body } : null;
  } catch {
    return null;
  }
}

export default async function LegalPage({ params }: Props) {
  const { slug } = await params;
  if (!(LEGAL_SLUGS as readonly string[]).includes(slug)) notFound();

  const content = (await loadStored(slug)) ?? LEGAL_PAGES[slug];
  if (!content) notFound();

  // Plain paragraphs only. React escapes everything; no raw HTML is ever rendered.
  const paragraphs = safeText(content.body)
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\n/g, ' ').trim())
    .filter(Boolean);

  return (
    <main id="main" className="yv-container" style={{ paddingBlock: '2rem', maxWidth: 860 }}>
      <div className="yv-stack">
        <div>
          <Badge tone="warning">[LEGAL REVIEW NEEDED]</Badge>
          <h1 style={{ marginTop: '0.75rem' }}>{safeText(content.title)}</h1>
          <p className="yv-muted">{safeText(content.summary)}</p>
        </div>

        <Card className="yv-stack">
          {paragraphs.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </Card>

        <Card>
          <h2 style={{ fontSize: '1.1rem' }}>Placeholders awaiting approval</h2>
          <p className="yv-tiny yv-muted">[YOUR NAME] · [SUPPORT EMAIL] · [DOMAIN] · [LEGAL REVIEW NEEDED]</p>
          <p className="yv-tiny yv-muted">
            This draft references the Ghana Data Protection Act 2012 (Act 843). It is not legal advice.
          </p>
        </Card>

        <div className="yv-row">
          <Link className="yv-btn yv-btn-outline" href="/">
            Back to Yivents
          </Link>
          <Link className="yv-btn yv-btn-ghost" href="/legal/contact">
            Contact
          </Link>
        </div>
      </div>
    </main>
  );
}
