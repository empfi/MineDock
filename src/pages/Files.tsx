import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { File as FileIcon, Folder, Trash2, ArrowUpCircle, Save, X, PlusCircle, Edit2 } from 'lucide-react';

interface FileInfo {
  name: string;
  is_dir: boolean;
  size: number;
  modified: number;
}

function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export default function Files() {
  const { servers, selectedServerId, settings } = useStore();
  const selectedServer = servers.find(s => s.id === selectedServerId);

  const [currentPath, setCurrentPath] = useState('.');
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingFile, setEditingFile] = useState<{name: string, content: string} | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (selectedServer) {
      setCurrentPath('.');
      loadFiles('.');
    }
  }, [selectedServerId]);

  const loadFiles = async (path: string) => {
    if (!selectedServer) return;
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<FileInfo[]>('get_directory_contents', {
        baseDir: selectedServer.install_path,
        subPath: path
      });
      setFiles(data);
      setCurrentPath(path);
    } catch (err: any) {
      setError(err.toString());
    } finally {
      setLoading(false);
    }
  };

  const navigateUp = () => {
    if (currentPath === '.') return;
    const parts = currentPath.split('/');
    parts.pop();
    const newPath = parts.length > 0 ? parts.join('/') : '.';
    loadFiles(newPath);
  };

  const handleFileClick = async (file: FileInfo) => {
    const newPath = currentPath === '.' ? file.name : `${currentPath}/${file.name}`;
    if (file.is_dir) {
      loadFiles(newPath);
    } else {
      // Basic check for text files to edit
      const ext = file.name.split('.').pop()?.toLowerCase();
      const textExts = ['txt', 'json', 'yml', 'yaml', 'properties', 'log', 'sh', 'bat', 'xml'];
      if (!ext || !textExts.includes(ext)) {
        alert("This file type cannot be edited in the browser.");
        return;
      }

      try {
        const content = await invoke<string>('read_file_content', {
          baseDir: selectedServer!.install_path,
          subPath: newPath
        });
        setEditingFile({ name: newPath, content });
      } catch (err: any) {
        alert("Failed to read file: " + err);
      }
    }
  };

  const saveFile = async () => {
    if (!editingFile || !selectedServer) return;
    setSaving(true);
    try {
      await invoke('save_file_content', {
        baseDir: selectedServer.install_path,
        subPath: editingFile.name,
        content: editingFile.content
      });
      setEditingFile(null);
      loadFiles(currentPath);
    } catch (err: any) {
      alert("Failed to save file: " + err);
    } finally {
      setSaving(false);
    }
  };

  const deleteFile = async (e: React.MouseEvent, file: FileInfo) => {
    e.stopPropagation();
    if (!selectedServer) return;

    if (settings?.confirm_delete) {
      if (!confirm(`Are you sure you want to delete ${file.name}?`)) return;
    }

    const pathToDelete = currentPath === '.' ? file.name : `${currentPath}/${file.name}`;
    try {
      await invoke('delete_file_or_folder', {
        baseDir: selectedServer.install_path,
        subPath: pathToDelete
      });
      loadFiles(currentPath);
    } catch (err: any) {
      alert("Failed to delete: " + err);
    }
  };

  const createFolder = async () => {
    if (!selectedServer) return;
    const name = prompt("Enter new folder name:");
    if (!name) return;

    const newPath = currentPath === '.' ? name : `${currentPath}/${name}`;
    try {
      await invoke('create_new_folder', {
        baseDir: selectedServer.install_path,
        subPath: newPath
      });
      loadFiles(currentPath);
    } catch (err: any) {
      alert("Failed to create folder: " + err);
    }
  };

  if (!selectedServer) {
    return <div className="p-8 text-center text-gray-500">Select a server from the sidebar.</div>;
  }

  if (editingFile) {
    return (
      <div className="flex flex-col h-full bg-[#0f0f11] p-4">
        <div className="flex justify-between items-center bg-[#1c1d21] p-4 rounded-t-lg border border-[#2a2b2f] border-b-0">
          <div className="flex items-center gap-3">
            <Edit2 size={20} className="text-gray-400" />
            <h2 className="font-semibold text-white">{editingFile.name}</h2>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setEditingFile(null)} className="flex items-center gap-2 bg-[#2a2b2f] hover:bg-[#3a3b3f] text-white px-3 py-1.5 rounded text-sm transition-colors">
              <X size={14} /> Cancel
            </button>
            <button onClick={saveFile} disabled={saving} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-sm transition-colors disabled:opacity-50">
              <Save size={14} /> {saving ? 'Saving...' : 'Save File'}
            </button>
          </div>
        </div>
        <div className="flex-1 border border-[#2a2b2f]">
          <textarea
            value={editingFile.content}
            onChange={(e) => setEditingFile({...editingFile, content: e.target.value})}
            className="w-full h-full bg-[#09090a] text-gray-200 p-4 font-mono text-sm focus:outline-none resize-none"
            spellCheck="false"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto h-full flex flex-col">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-1">File Manager</h1>
          <p className="text-gray-400 font-mono text-sm mt-2 flex items-center gap-2">
            /{currentPath !== '.' ? currentPath : ''}
          </p>
        </div>
        <div className="flex gap-2">
           <button onClick={createFolder} className="flex items-center gap-2 bg-[#2a2b2f] hover:bg-[#3a3b3f] text-white px-3 py-2 rounded-md text-sm transition-colors">
             <PlusCircle size={16} /> New Folder
           </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-md text-sm">
          {error}
        </div>
      )}

      <div className="flex-1 bg-[#1c1d21] border border-[#2a2b2f] rounded-lg overflow-hidden flex flex-col">
        <table className="w-full text-left">
          <thead className="bg-[#141517] border-b border-[#2a2b2f] text-xs font-semibold text-gray-400 uppercase tracking-wider sticky top-0">
            <tr>
              <th className="px-6 py-4 w-1/2">Name</th>
              <th className="px-6 py-4">Size</th>
              <th className="px-6 py-4">Last Modified</th>
              <th className="px-6 py-4 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2a2b2f] overflow-y-auto block h-[calc(100vh-250px)]" style={{ display: 'table-row-group' }}>
            
            {currentPath !== '.' && (
              <tr className="hover:bg-[#202124] transition-colors cursor-pointer" onClick={navigateUp}>
                <td colSpan={4} className="px-6 py-3 font-medium text-blue-400 flex items-center gap-3">
                  <ArrowUpCircle size={18} /> ..
                </td>
              </tr>
            )}

            {loading ? (
              <tr><td colSpan={4} className="px-6 py-8 text-center text-gray-500">Loading...</td></tr>
            ) : files.length === 0 ? (
              <tr><td colSpan={4} className="px-6 py-8 text-center text-gray-500">Directory is empty.</td></tr>
            ) : (
              files.map(file => (
                <tr key={file.name} className="hover:bg-[#202124] transition-colors cursor-pointer group" onClick={() => handleFileClick(file)}>
                  <td className="px-6 py-3 font-medium text-white flex items-center gap-3">
                    {file.is_dir ? <Folder size={18} className="text-blue-400" /> : <FileIcon size={18} className="text-gray-400" />}
                    {file.name}
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-400">
                    {file.is_dir ? '-' : formatBytes(file.size)}
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-400">
                    {new Date(file.modified * 1000).toLocaleString()}
                  </td>
                  <td className="px-6 py-3 text-right">
                    <button onClick={(e) => deleteFile(e, file)} className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-[#2a2b2f] rounded opacity-0 group-hover:opacity-100 transition-all">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
