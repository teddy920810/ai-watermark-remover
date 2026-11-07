import { ArrowRight, Check } from 'lucide-react';
import { formatPrice, safeReturnPath, type PaymentCatalog } from './payment-client';
import { checkoutPath } from './checkout-selection';

const imageOperations = [
  { operation: 'watermark-removal', label: 'Watermark removal' },
  { operation: 'background-removal', label: 'Background removal' },
  { operation: 'object-removal', label: 'Object removal' },
] as const;
const sharedOperations = [
  { operation: 'image-watermark', label: 'Watermark removal' },
  { operation: 'image-watermark-pro', label: 'PRO watermark removal' },
  { operation: 'image-refine', label: 'Brush refinement' },
  { operation: 'background-removal', label: 'Background removal' },
  { operation: 'object-removal', label: 'Object removal' },
] as const;

/** Pure request-rendered catalog. No hydration, auth, SDK, orders or client configuration. */
export default function CreditCatalog({ catalog, returnTo }: { catalog: PaymentCatalog; returnTo?: string | null }) {
  const shared = catalog.universalCredits;
  const imageCostsConfigured = catalog.imageCosts && imageOperations.every(({ operation }) => Number.isSafeInteger(catalog.imageCosts?.[operation]) && catalog.imageCosts![operation] > 0);
  return <>
    {!catalog.enabled ? <p className="payment-notice">Purchases are not available yet. No payment can be made. Package prices are previews until checkout opens.</p> : null}
    {catalog.enabled && catalog.environment === 'sandbox' ? <p className="payment-notice">Sandbox checkout — test accounts only. No real payment.</p> : null}
    <section className="credit-packages" aria-label={shared ? 'Credits packages' : 'Image credit packages'}>
      <article className="credit-package credit-package-free">
        <h2 className="credit-package-name">Free</h2><p className="credit-package-description">A little room to try things out.</p>
        <span className="credit-package-price">$0.00 <small>USD</small></span><strong className="credit-package-quantity">{shared ? `Start with ${shared.rewards.first} Credits` : 'Start with free image uses'}</strong>
        <a className="credit-package-cta" href={safeReturnPath(returnTo ?? null)}>Try for free <ArrowRight size={18} aria-hidden="true" /></a>
        <ul className="credit-package-features">{(shared ? [`${shared.rewards.first} Credits on first sign-in`, `Daily check-in adds up to ${shared.rewards.daily} Credits`, `Reward balance capped at ${shared.rewards.cap} Credits`, 'All six processing operations', 'No purchase needed'] : ['1 free use on first sign-in', 'Daily check-in adds 1 free use', 'Free-use balance capped at 3', 'All three standard image tools', 'No purchase needed']).map(text => <li key={text}><Check size={17} aria-hidden="true" />{text}</li>)}</ul>
      </article>
      {catalog.packages.map(item => <article key={item.sku} className={`credit-package ${item.sku === 'plus' ? 'is-recommended' : ''}`}>
        {item.sku === 'plus' ? <span className="credit-package-badge">Recommended</span> : null}
        <h2 className="credit-package-name">{item.name}</h2>
        <p className="credit-package-description">{item.sku === 'starter' ? 'For occasional image edits.' : item.sku === 'plus' ? 'More room for everyday projects.' : 'Ready for your next image project.'}</p>
        <span className="credit-package-price">{formatPrice(item.amountCents, item.currency)} <small>{item.currency}</small></span>
        <strong className="credit-package-quantity">{item.credits.toLocaleString('en-US')} credits</strong>
        <a className="credit-package-cta" href={checkoutPath(item.sku, returnTo)} aria-label={`Choose ${item.name}`}>Choose {item.name}<ArrowRight size={18} aria-hidden="true" /></a>
        <ul className="credit-package-features">{[shared ? 'All six processing operations' : 'All three standard image tools', shared ? 'Reward Credits are used first' : 'Free uses are used first', 'No scheduled credit expiry', 'One-time purchase · No automatic renewal', 'Local edits & downloads are free'].map(text => <li key={text}><Check size={17} aria-hidden="true" />{text}</li>)}</ul>
      </article>)}
    </section>
    <section className="payment-rates" aria-labelledby="payment-rates-heading">
      <div className="payment-rates-intro"><h2 id="payment-rates-heading">{shared ? 'Credits per operation' : 'Credits per image operation'}</h2><p>{shared ? 'One balance for images and video. Confirm the cost before processing.' : 'One balance. Three ways to create.'}</p></div>
      {shared ? <dl>{sharedOperations.map(({ operation, label }) => <div key={operation}><dt>{label}</dt><dd>{shared.imageRates[operation].toLocaleString('en-US')} Credits</dd></div>)}<div><dt>Video watermark removal</dt><dd>{shared.video.creditsPerStep} Credits per started {shared.video.stepSeconds} seconds</dd></div></dl> : imageCostsConfigured ? <dl>{imageOperations.map(({ operation, label }) => <div key={operation}><dt>{label}</dt><dd>{catalog.imageCosts![operation].toLocaleString('en-US')} credits</dd></div>)}</dl> : <p>Open a supported image tool to check its current credit cost before processing.</p>}
    </section>
  </>;
}
