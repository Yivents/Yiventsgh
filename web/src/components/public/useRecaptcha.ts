'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;

interface Grecaptcha {
  ready: (callback: () => void) => void;
  execute: (siteKey: string, options: { action: string }) => Promise<string>;
}

type GrecaptchaWindow = Window & { grecaptcha?: Grecaptcha };

/**
 * reCAPTCHA v3 is optional in Phase 1: when the site key is absent or the
 * script fails, we simply submit without a token and let the callable decide.
 */
export function useRecaptchaToken() {
  const [ready, setReady] = useState(false);
  const scriptRef = useRef<HTMLScriptElement | null>(null);

  useEffect(() => {
    if (!SITE_KEY) return;
    const win = window as GrecaptchaWindow;
    const markReady = () => win.grecaptcha?.ready(() => setReady(true));

    if (win.grecaptcha) {
      markReady();
      return;
    }
    const previous = win as GrecaptchaWindow & { ___recaptchaOnload?: () => void };
    previous.___recaptchaOnload = markReady;
    const script = document.createElement('script');
    script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(SITE_KEY)}&onload=___recaptchaOnload`;
    script.async = true;
    script.defer = true;
    scriptRef.current = script;
    document.head.appendChild(script);
    // Poll briefly as a fallback if the global callback is blocked.
    const poll = window.setInterval(() => {
      if (win.grecaptcha) {
        setReady(true);
        window.clearInterval(poll);
      }
    }, 500);
    const stop = window.setTimeout(() => window.clearInterval(poll), 8000);
    return () => {
      window.clearInterval(poll);
      window.clearTimeout(stop);
      script.remove();
      scriptRef.current = null;
    };
  }, []);

  return useCallback(
    async (action: string): Promise<string | undefined> => {
      if (!SITE_KEY || !ready) return undefined;
      const grecaptcha = (window as GrecaptchaWindow).grecaptcha;
      if (!grecaptcha) return undefined;
      try {
        return await grecaptcha.execute(SITE_KEY, { action });
      } catch {
        return undefined;
      }
    },
    [ready],
  );
}
