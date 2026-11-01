import { describe, expect, it, vi } from 'vitest';
import { listenForAuthCompletion } from './auth-completion';

const message = (data: unknown, origin = 'https://site.test') => new MessageEvent('message', { data, origin });
function fixture() {
  const target = Object.assign(new EventTarget(), { location: { origin: 'https://site.test' } });
  const channel = Object.assign(new EventTarget(), { close: vi.fn() });
  return { target, channel, ports: { target: target as unknown as Window, channel: channel as unknown as BroadcastChannel } };
}
describe('shared popup completion lifecycle', () => {
  it('verifies the session once for concurrent same-origin and broadcast signals and cleans up listeners', async () => {
    const f = fixture(); let finish!: (value: boolean) => void;
    const confirm = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const onConfirmed = vi.fn(); const onRejected = vi.fn();
    const dispose = listenForAuthCompletion({ ...f.ports, confirm, onConfirmed, onRejected });
    f.target.dispatchEvent(message({ type: 'clearmark-auth-complete' }, 'https://outside.test'));
    f.target.dispatchEvent(message({ type: 'unrelated' })); expect(confirm).not.toHaveBeenCalled();
    f.target.dispatchEvent(message({ type: 'clearmark-auth-complete' }));
    f.channel.dispatchEvent(message({ type: 'clearmark-auth-complete' }));
    expect(confirm).toHaveBeenCalledTimes(1); finish(true); await vi.waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(1));
    f.target.dispatchEvent(message({ type: 'clearmark-auth-complete' })); expect(confirm).toHaveBeenCalledTimes(1);
    dispose(); f.channel.dispatchEvent(message({ type: 'clearmark-auth-complete' }));
    expect(f.channel.close).toHaveBeenCalledTimes(1); expect(onRejected).not.toHaveBeenCalled();
  });
  it('keeps business policies explicit, supports retry after rejection and ignores late completion after disposal', async () => {
    const f=fixture(); const confirm=vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true); const onConfirmed=vi.fn(); const onRejected=vi.fn();
    const dispose=listenForAuthCompletion({...f.ports,confirm,onConfirmed,onRejected,once:false});
    f.target.dispatchEvent(message({type:'clearmark-auth-complete'})); await vi.waitFor(()=>expect(onRejected).toHaveBeenCalledTimes(1));
    f.target.dispatchEvent(message({type:'clearmark-auth-complete'})); await vi.waitFor(()=>expect(onConfirmed).toHaveBeenCalledTimes(1));
    f.target.dispatchEvent(message({type:'clearmark-auth-complete'})); await vi.waitFor(()=>expect(onConfirmed).toHaveBeenCalledTimes(2)); dispose();
    const late=fixture(); let finish!: (value:boolean)=>void; const confirmed=vi.fn();
    const cleanup=listenForAuthCompletion({...late.ports,confirm:()=>new Promise(resolve=>{finish=resolve}),onConfirmed:confirmed,onRejected:vi.fn()});
    late.target.dispatchEvent(message({type:'clearmark-auth-complete'})); cleanup(); finish(true); await Promise.resolve(); expect(confirmed).not.toHaveBeenCalled();
  });
  it('turns a failed session check into the existing retryable rejection callback', async () => {
    const f=fixture(); const onRejected=vi.fn(); const cleanup=listenForAuthCompletion({...f.ports,confirm:async()=>{throw new Error('offline')},onConfirmed:vi.fn(),onRejected});
    f.target.dispatchEvent(message({type:'clearmark-auth-complete'})); await vi.waitFor(()=>expect(onRejected).toHaveBeenCalledTimes(1));cleanup();
  });
});
