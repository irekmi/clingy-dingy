// Reklamy Google AdSense – jeden stały pas na dole ekranu.
// Pokazujemy go TYLKO poza wyścigiem (menu, lobby, wyniki, strony informacyjne), nigdy w trakcie biegu.
// Bez VITE_ADSENSE_CLIENT reklamy są wyłączone (w trybie dev widać tylko makietę miejsca).
const client = import.meta.env.VITE_ADSENSE_CLIENT as string | undefined;
const slot = import.meta.env.VITE_ADSENSE_SLOT as string | undefined;

const configured = Boolean(client && /^ca-pub-\d+$/.test(client) && slot);
export const adsAvailable = configured || import.meta.env.DEV;

let dockVisible = false;
let started = false;

function start() {
  if (started) return;
  started = true;
  const dock = document.getElementById('ad-dock')!;
  if (!configured) {
    dock.innerHTML = '<div class="ad-mock">Miejsce na reklamę (podgląd dev)</div>';
    return;
  }
  // Okno zgody na cookies (CMP) wyświetla sam Google po włączeniu „Prywatność i komunikaty” w AdSense.
  const s = document.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`;
  document.head.append(s);
  dock.innerHTML = `<ins class="adsbygoogle" style="display:block;width:100%;height:90px" data-ad-client="${client}" data-ad-slot="${slot}"></ins>`;
  try {
    ((window as unknown as { adsbygoogle?: unknown[] }).adsbygoogle ??= []).push({});
  } catch {
    /* reklamy zablokowane – gra działa dalej */
  }
}

/** Pokazuje/ukrywa pas reklamowy (wywoływane co klatkę – zmienia DOM tylko przy zmianie). */
export function setAdsVisible(visible: boolean) {
  const show = visible && adsAvailable;
  if (show === dockVisible) return;
  dockVisible = show;
  if (show) start();
  document.getElementById('ad-dock')!.classList.toggle('hidden', !show);
  document.getElementById('game')!.classList.toggle('ads-on', show);
}
