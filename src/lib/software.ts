export type SoftwareId = 'vanilla' | 'paper' | 'purpur' | 'velocity' | 'fabric' | 'forge' | 'neoforge';

export interface SoftwareInfo {
  id: SoftwareId;
  name: string;
  description: string;
  icon: string;
}

export const SOFTWARE: SoftwareInfo[] = [
  { id: 'vanilla', name: 'Vanilla', description: 'Official Minecraft server', icon: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Minecraft_cube.svg' },
  { id: 'paper', name: 'Paper', description: 'Fast plugin server', icon: '/software/paper.svg' },
  { id: 'purpur', name: 'Purpur', description: 'Configurable Paper fork', icon: '/software/purpur.svg' },
  { id: 'velocity', name: 'Velocity', description: 'Modern proxy server', icon: '/software/velocity.svg' },
  { id: 'fabric', name: 'Fabric', description: 'Lightweight mod loader', icon: 'https://fabricmc.net/assets/logo.png' },
  { id: 'forge', name: 'Forge', description: 'Classic mod loader', icon: 'https://raw.githubusercontent.com/MinecraftForge/MinecraftForge/HEAD/docs/assets/Forge_logo.svg' },
  { id: 'neoforge', name: 'NeoForge', description: 'Modern Forge successor', icon: 'https://raw.githubusercontent.com/neoforged/NeoForge/HEAD/docs/assets/neoforged_logo.png' },
];

export function getSoftwareInfo(serverType: string): SoftwareInfo {
  return SOFTWARE.find(item => item.id === serverType) ?? {
    id: 'vanilla',
    name: serverType,
    description: '',
    icon: '/logo.png',
  };
}
