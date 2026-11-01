import '../../styles/payments.css';

export function imageCreditPurchaseHref() {
  const returnTo = typeof window === 'undefined' ? '/app/image'
    : /^\/app(?:\/|$)/.test(window.location.pathname) ? `${window.location.pathname}${window.location.search}${window.location.hash}`
      : `${window.location.pathname}#tool`;
  return `/pricing?returnTo=${encodeURIComponent(returnTo)}`;
}

export default function BuyCreditsLink({ message }: { message: string | null }) {
  if (!message || !/no (?:free uses|credits)|insufficient (?:credits|balance)|credits? remaining/i.test(message)) return null;
  return (
    <p className="credit-purchase-prompt">
      <a href={imageCreditPurchaseHref()} target="_blank" rel="noopener noreferrer">Buy image credits</a>
      {' '}in a new tab. Your image stays here; return and retry after your credits arrive.
    </p>
  );
}
