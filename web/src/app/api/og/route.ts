/**
 * Plain-text Open Graph image. Query values are escaped by React/Satori;
 * no user HTML is ever interpreted.
 */
import { createElement } from 'react';
import { ImageResponse } from 'next/og';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

function plain(value: string | null, fallback: string, max: number): string {
  const cleaned = (value ?? '')
    .replace(/[\u0000-\u001F]/g, ' ')
    .replace(/<[a-z][\s\S]*>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || fallback).slice(0, max);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const title = plain(params.get('title') ?? params.get('slug'), 'Yivents event', 110);
  const description = plain(params.get('description'), 'Registration and tickets on Yivents', 170);

  // Fetch the local logo as a data URL so Satori does not depend on a remote fetch.
  let logoDataUrl: string | undefined;
  try {
    const logoUrl = new URL('/brand/logo.png', request.nextUrl.origin).toString();
    const response = await fetch(logoUrl);
    if (response.ok) {
      logoDataUrl = `data:image/png;base64,${Buffer.from(await response.arrayBuffer()).toString('base64')}`;
    }
  } catch {
    logoDataUrl = undefined;
  }

  return new ImageResponse(
    createElement(
      'div',
      {
        style: {
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px',
          background: 'linear-gradient(140deg, #EAF1FA 0%, #FFF2DF 100%)',
          color: '#14213D',
          fontFamily: 'sans-serif',
        },
      },
      createElement(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: '20px' } },
        logoDataUrl
          ? createElement('img', { src: logoDataUrl, alt: '', width: 72, height: 72 })
          : createElement('div', { style: { fontSize: 34, fontWeight: 800, color: '#104080' } }, 'Yivents'),
        createElement('div', { style: { fontSize: 28, fontWeight: 700, color: '#104080' } }, 'Yivents'),
      ),
      createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '16px' } },
        createElement('div', { style: { fontSize: 66, fontWeight: 800, lineHeight: 1.1, maxWidth: '1000px' } }, title),
        createElement('div', { style: { fontSize: 30, color: '#4B5B75', maxWidth: '980px' } }, description),
      ),
      createElement('div', { style: { fontSize: 22, color: '#104080' } }, 'Register • Ticket • Door check-in'),
    ),
    { width: 1200, height: 630 },
  );
}
