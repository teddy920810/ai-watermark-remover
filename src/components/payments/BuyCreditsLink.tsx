import '../../styles/payments.css';

export default function BuyCreditsLink({ message }: { message: string | null }) {
  if (!message || !/no (?:free uses|credits)|insufficient (?:credits|balance)|credits? remaining/i.test(message)) return null;
  const returnTo = typeof window === 'undefined' ? '/app/image' : `${window.location.pathname}#tool`;
  return (
    <p className="credit-purchase-prompt">
      <a href={`/app/credits?returnTo=${encodeURIComponent(returnTo)}`} target="_blank" rel="noopener noreferrer">Buy image credits</a>
      {' '}in a new tab. Your image stays here; return and retry after your credits arrive.
    </p>
  );
}
