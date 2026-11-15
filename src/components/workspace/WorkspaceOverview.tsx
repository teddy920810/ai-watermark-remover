import { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Gift, History, Monitor } from 'lucide-react';
import { authClient } from '../auth/auth-client';
import { creditPolicy } from '../../lib/credits/credit-policy';
import { workspaceApi, displayError, type PublicJob } from './workspace-api';
import { WorkspaceShell, WorkspaceToolIcon } from './WorkspaceShell';
import { workspaceTools, workspaceToolLabel } from './workspace-tools';
import { creditLabel, processingLabel } from './workspace-state';

export function WorkspaceOverview({ logo, siteName, recent = false }: { logo: string; siteName: string; recent?: boolean }) {
  const { data: session } = authClient.useSession();
  const [jobs, setJobs] = useState<PublicJob[]>([]); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const [loadedOwner, setLoadedOwner] = useState<string | undefined>();
  useEffect(() => {
    setJobs([]); setError(''); setLoadedOwner(undefined);
    if (!recent || !session?.user.id) { setLoading(false); return; }
    let active = true; const owner = session.user.id; setLoading(true);
    void workspaceApi<{ jobs: PublicJob[] }>('/jobs').then(value => { if (active) { setJobs(value.jobs); setLoadedOwner(owner); } }).catch(cause => { if (active) setError(displayError(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [recent, session?.user.id]);
  const signIn = () => window.dispatchEvent(new Event('workspace:sign-in'));
  return <WorkspaceShell logo={logo} siteName={siteName} active={recent ? 'recent' : 'home'}><main className="unified-overview">
    {recent ? <><div className="unified-intro"><h1>Recent Tasks</h1><p>Your paid processing tasks, together in one place.</p></div><p className="unified-local-note"><Monitor size={18} />Gemini results stay on your device while its tool is open. TikTok links are not saved as cloud tasks.</p>
      {error ? <p className="workspace-error" role="alert">{error}<button type="button" onClick={() => window.location.reload()}>Retry</button></p> : loading ? <p role="status">Loading your tasks…</p> : session?.user && loadedOwner === session.user.id && jobs.length ? <ul className="unified-task-list">{jobs.map(job => <li key={job.id}><a href={`/app?job=${encodeURIComponent(job.id)}&operation=${encodeURIComponent(job.operation)}`}><History size={21} /><span><strong>{workspaceToolLabel(job.operation)}</strong><small>{new Date(job.createdAt).toLocaleString()}</small></span><span>{processingLabel(job.status)}</span>{job.charge && <small>{creditLabel(job.charge.amount, job.charge.unit)}</small>}<ArrowRight size={17} /></a></li>)}</ul> : <div className="unified-empty"><History size={32} /><h2>{session?.user ? 'No tasks yet' : 'Your tasks are a sign-in away'}</h2><p>{session?.user ? 'Your cloud processing tasks will appear here.' : 'Sign in to restore your recent tasks.'}</p>{!session?.user && <button className="button button-primary" type="button" onClick={signIn}>Sign in with Google</button>}</div>}
    </> : <><div className="unified-intro"><span>YOUR CREATIVE WORKSPACE</span><h1>Less watermark. More possibility.</h1><p>One workspace for your images and videos. Pick a tool to get started.</p></div>
      {[true, false].map(free => <section className={`unified-tool-section${free ? '' : ' is-paid'}`} key={String(free)}><div className="unified-section-title"><div><h2>{free ? 'Free Tools' : 'Paid Tools'}<span className={`unified-badge${free ? ' is-free' : ''}`}>{free ? 'Free' : 'Credits'}</span></h2><p>{free ? 'Ready for everyone. No account or Credits needed.' : 'More ways to clean up your content. Confirm the cost before you process.'}</p></div>{free && <span className="unified-always-free"><CheckCircle2 size={15} />Always free</span>}</div><div className="unified-tool-grid">{workspaceTools.filter(tool => tool.free === free).map(tool => <a key={tool.id} className="unified-tool-card" href={tool.href}><span className="unified-tool-icon"><WorkspaceToolIcon icon={tool.icon} /></span><h3>{tool.label}</h3><p>{tool.description}</p><span className="unified-tool-bottom"><span>{tool.free ? tool.id === 'gemini' ? 'Gemini images & videos' : 'TikTok video links' : 'Review cost before processing'}</span><ArrowRight size={19} /></span></a>)}</div></section>)}
      {!session?.user && <div className="unified-welcome"><Gift size={26} /><div><h3>Your first {creditPolicy.rewards.first} Credits are on us.</h3><p>Create an account to try paid tools. Free tools work without signing in.</p></div><button type="button" className="button button-primary" onClick={signIn}>Get {creditPolicy.rewards.first} Free Credits <ArrowRight size={16} /></button></div>}
    </>}
  </main></WorkspaceShell>;
}
