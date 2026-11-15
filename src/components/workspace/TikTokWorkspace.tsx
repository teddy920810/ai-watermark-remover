import TikTokDownloader from './TikTokDownloader';
import { WorkspaceShell } from './WorkspaceShell';
export default function TikTokWorkspace({ logo, siteName }: { logo: string; siteName: string }) {
  return <WorkspaceShell logo={logo} siteName={siteName} active="tiktok"><TikTokDownloader /></WorkspaceShell>;
}
