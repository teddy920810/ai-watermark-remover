import { UserRound } from 'lucide-react';
interface Props {
  user?: { image?: string | null } | null;
  pending: boolean;
  signIn(): void | Promise<void>;
  signOut(): void | Promise<void>;
}
export function WorkspaceAccount({ user, pending, signIn, signOut }: Props) {
  return user ? <button className="workspace-account" type="button" onClick={() => void signOut()} title="Sign out and clear local drafts">{user.image ? <img src={user.image} alt="" referrerPolicy="no-referrer" /> : <UserRound size={22} aria-hidden="true" />}<span>Sign out</span></button>
    : <button type="button" className="header-cta" disabled={pending} onClick={() => void signIn()}>Sign in with Google</button>;
}
