import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { File as FileIcon, Folder, Trash2, ArrowUpCircle, Save, X, PlusCircle, Edit2, UploadCloud, ChevronDown, Search } from 'lucide-react';
import Editor from '@monaco-editor/react';
import ConfirmDialog from '../components/ConfirmDialog';
import { notify } from '../components/Notifications';
import UnsavedChangesBar from '../components/UnsavedChangesBar';

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

function getMonacoLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    json: 'json',
    yml: 'yaml',
    yaml: 'yaml',
    xml: 'xml',
    properties: 'ini',
    txt: 'plaintext',
    log: 'plaintext',
    sh: 'shell',
    bat: 'bat',
    md: 'markdown',
    toml: 'ini',
    conf: 'ini',
    cfg: 'ini',
  };
  return map[ext] ?? 'plaintext';
}

export default function Files() {
  const { servers, selectedServerId, settings } = useStore();
  const selectedServer = servers.find(s => s.id === selectedServerId);

  const [currentPath, setCurrentPath] = useState('.');
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingFile, setEditingFile] = useState<{name: string, content: string, originalContent: string} | null>(null);
  const [saving, setSaving] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<FileInfo | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [createType, setCreateType] = useState<'file' | 'folder' | null>(null);
  const [createName, setCreateName] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const savedScrollTop = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    setSearchQuery('');
  }, [currentPath]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (editingFile) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingFile]);

  const filteredFiles = files.filter(file =>
    file.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  useEffect(() => {
    if (selectedServer) {
      setCurrentPath('.');
      loadFiles('.');
    }
  }, [selectedServerId]);

  useEffect(() => {
    if (!selectedServer || editingFile) return;
    const timer = window.setInterval(() => loadFiles(currentPath, true), 2000);
    return () => window.clearInterval(timer);
  }, [selectedServerId, currentPath, editingFile]);

  const loadFiles = async (path: string, quiet = false) => {
    if (!selectedServer) return;
    if (!quiet) setLoading(true);
    if (!quiet) setError(null);
    try {
      const data = await invoke<FileInfo[]>('get_directory_contents', {
        baseDir: selectedServer.install_path,
        subPath: path
      });
      setFiles(data);
      setCurrentPath(path);
    } catch (err: any) {
      if (!quiet) setError(err.toString());
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedServer || editingFile) return;
    const listener = getCurrentWebview().onDragDropEvent(event => {
      if (event.payload.type === 'enter' || event.payload.type === 'over') {
        setDragActive(true);
      } else if (event.payload.type === 'leave') {
        setDragActive(false);
      } else {
        setDragActive(false);
        invoke<number>('import_dropped_files', {
          baseDir: selectedServer.install_path,
          subPath: currentPath,
          paths: event.payload.paths,
        }).then(count => {
          notify(`${count} file${count === 1 ? '' : 's'} uploaded`, 'success');
          loadFiles(currentPath, true);
        }).catch(cause => notify(`Upload failed: ${cause}`, 'error'));
      }
    });
    return () => { listener.then(unlisten => unlisten()); };
  }, [selectedServerId, currentPath, editingFile]);

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
      savedScrollTop.current = listRef.current?.scrollTop ?? 0;
      const ext = file.name.split('.').pop()?.toLowerCase();
      const textExts = ['txt', 'json', 'yml', 'yaml', 'properties', 'log', 'sh', 'bat', 'xml', 'md', 'toml', 'conf', 'cfg'];
      if (!ext || !textExts.includes(ext)) {
        return;
      }

      try {
        const content = await invoke<string>('read_file_content', {
          baseDir: selectedServer!.install_path,
          subPath: newPath
        });
        setEditingFile({ name: newPath, content, originalContent: content });
      } catch (err: any) {
        notify('Failed to read file: ' + err, 'error');
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
      setEditingFile({...editingFile, originalContent: editingFile.content});
      notify('File saved.', 'success', false);
    } catch (err: any) {
      notify('Failed to save file: ' + err, 'error');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!editingFile) return;
    const saveShortcut = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!saving && editingFile.content !== editingFile.originalContent) saveFile();
      }
    };
    window.addEventListener('keydown', saveShortcut);
    return () => window.removeEventListener('keydown', saveShortcut);
  }, [editingFile, saving]);

  const performDelete = async (file: FileInfo) => {
    if (!selectedServer) return;
    const pathToDelete = currentPath === '.' ? file.name : `${currentPath}/${file.name}`;
    try {
      const result = await invoke<string>('delete_file_or_folder', { baseDir: selectedServer.install_path, subPath: pathToDelete });
      setFileToDelete(null);
      if (result === 'scheduled') {
        notify(`${file.name} is in use. It will be deleted before next server start.`, 'warning', false);
      } else {
        notify(`${file.name} deleted.`, 'success', false);
        loadFiles(currentPath, true);
      }
    } catch (err: any) {
      notify('Failed to delete: ' + err, 'error');
    }
  };

  const deleteFile = (e: React.MouseEvent, file: FileInfo) => {
    e.stopPropagation();
    if (settings?.confirm_delete) setFileToDelete(file);
    else performDelete(file);
  };

  const createEntry = async () => {
    if (!selectedServer || !createType || !createName.trim()) return;
    const name = createName.trim();
    const newPath = currentPath === '.' ? name : `${currentPath}/${name}`;
    try {
      if (createType === 'folder') {
        await invoke('create_new_folder', { baseDir: selectedServer.install_path, subPath: newPath });
        await loadFiles(currentPath);
      } else {
        await invoke('save_file_content', { baseDir: selectedServer.install_path, subPath: newPath, content: '' });
        setEditingFile({ name: newPath, content: '', originalContent: '' });
      }
      setCreateType(null);
      setCreateName('');
    } catch (err: any) {
      notify(`Failed to create ${createType}: ${err}`, 'error');
    }
  };

  const closeEditor = () => {
    setEditingFile(null);
    requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = savedScrollTop.current;
    });
  };

  if (!selectedServer) {
    return <div className="p-8 text-center text-gray-500">Select a server from the sidebar.</div>;
  }

  if (editingFile) {
    const language = getMonacoLanguage(editingFile.name);
    return (
      <div className="flex flex-col h-full bg-[#0f0f11]">
        {/* Editor toolbar */}
        <div className="flex justify-between items-center bg-[#1c1d21] px-5 py-3 border-b border-[#2a2b2f] flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <Edit2 size={16} className="text-gray-400 flex-shrink-0" />
            <h2 className="font-mono text-sm text-white truncate">{editingFile.name}</h2>
            <span className="text-xs text-gray-600 bg-[#2a2b2f] px-2 py-0.5 rounded font-mono flex-shrink-0">{language}</span>
          </div>
          <div className="flex gap-2 flex-shrink-0 ml-4">
            <button
              onClick={closeEditor}
              className="flex items-center gap-2 bg-[#2a2b2f] hover:bg-[#3a3b3f] text-white px-3 py-1.5 rounded text-sm transition-colors"
            >
              <X size={14} /> Cancel
            </button>
            <button
              onClick={saveFile}
              disabled={saving || editingFile.content === editingFile.originalContent}
              title={editingFile.content === editingFile.originalContent ? 'No unsaved changes' : saving ? 'Saving file' : 'Save file'}
              className="action-button bg-blue-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              style={{ '--action-width': '7rem' } as React.CSSProperties}
            >
              <Save size={14} /> {saving ? 'Saving...' : 'Save File'}
            </button>
          </div>
        </div>

        {/* Monaco editor */}
        <div className="flex-1 min-h-0">
          <Editor
            height="100%"
            language={language}
            theme="vs-dark"
            value={editingFile.content}
            onChange={value => setEditingFile({ ...editingFile, content: value ?? '' })}
            options={{
              fontSize: 13,
              fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", Menlo, monospace',
              fontLigatures: true,
              minimap: { enabled: true },
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              lineNumbers: 'on',
              renderLineHighlight: 'all',
              smoothScrolling: true,
              cursorSmoothCaretAnimation: 'on',
              bracketPairColorization: { enabled: true },
              padding: { top: 12, bottom: 12 },
              scrollbar: {
                verticalScrollbarSize: 8,
                horizontalScrollbarSize: 8,
              },
            }}
          />
        </div>
        <UnsavedChangesBar
          dirty={editingFile.content !== editingFile.originalContent}
          saving={saving}
          onSave={saveFile}
          onReset={() => setEditingFile({...editingFile, content: editingFile.originalContent})}
        />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full h-full flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-1">File Manager</h1>
          <p className="text-gray-400 font-mono text-sm mt-1 flex items-center gap-2">
            /{currentPath !== '.' ? currentPath : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setSearchQuery('');
                  searchRef.current?.blur();
                }
              }}
              placeholder="Search files... (Ctrl+F)"
              className="w-full bg-[#0f0f11] border border-[#2a2b2f] rounded-md pl-9 pr-8 py-2 text-sm text-white focus:outline-none focus:border-blue-500 font-sans"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="relative">
            <button onClick={() => setCreateMenuOpen(open => !open)} className="flex items-center gap-2 bg-[#2a2b2f] hover:bg-[#3a3b3f] text-white px-3 py-2 rounded-md text-sm transition-colors">
              <PlusCircle size={16} /> Create <ChevronDown size={14} />
            </button>
            {createMenuOpen && (
              <div className="absolute right-0 top-11 z-30 w-40 overflow-hidden rounded-md border border-[#2a2b2f] bg-[#1c1d21] p-1 shadow-xl">
                <button onClick={() => { setCreateType('file'); setCreateMenuOpen(false); }} className="w-full rounded px-3 py-2 text-left text-sm text-gray-300 hover:bg-[#2a2b2f] hover:text-white">Text file</button>
                <button onClick={() => { setCreateType('folder'); setCreateMenuOpen(false); }} className="w-full rounded px-3 py-2 text-left text-sm text-gray-300 hover:bg-[#2a2b2f] hover:text-white">Folder</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-md text-sm">
          {error}
        </div>
      )}

      <div ref={listRef} className="relative flex-1 bg-[#1c1d21] border border-[#2a2b2f] rounded-lg overflow-y-auto">
        <div className={`pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-blue-400 bg-blue-500/15 backdrop-blur-sm transition-[opacity,transform] duration-200 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none ${dragActive ? 'opacity-100 scale-100' : 'opacity-0 scale-[0.985]'}`}>
          <div className="text-center">
            <UploadCloud size={40} className="mx-auto mb-3 text-blue-300" />
            <p className="font-semibold text-white">Drop files here</p>
            <p className="mt-1 text-sm text-blue-200">Upload to /{currentPath === '.' ? '' : currentPath}</p>
          </div>
        </div>
        <table className="w-full text-left">
          <thead className="bg-[#141517] border-b border-[#2a2b2f] text-xs font-semibold text-gray-400 uppercase tracking-wider sticky top-0">
            <tr>
              <th className="px-6 py-4 w-1/2">Name</th>
              <th className="px-6 py-4">Size</th>
              <th className="px-6 py-4">Last Modified</th>
              <th className="px-6 py-4 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2a2b2f]">
            {currentPath !== '.' && (
              <tr className="h-14 hover:bg-[#202124] transition-colors cursor-pointer" onClick={navigateUp}>
                <td colSpan={4} className="px-6 py-3 font-medium text-blue-400">
                  <div className="flex items-center gap-3"><ArrowUpCircle size={18} /> ..</div>
                </td>
              </tr>
            )}

            {loading ? (
              <>
                {Array.from({ length: 6 }).map((_, index) => (
                  <tr key={index} className="h-14 animate-pulse border-b border-[#222327]">
                    <td className="px-6"><div className="h-3 w-44 rounded bg-[#303136]" /></td>
                    <td className="px-6"><div className="h-3 w-16 rounded bg-[#292a2f]" /></td>
                    <td className="px-6"><div className="h-3 w-24 rounded bg-[#292a2f]" /></td>
                    <td />
                  </tr>
                ))}
              </>
            ) : filteredFiles.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                  {searchQuery ? `No files matching "${searchQuery}"` : 'Directory is empty.'}
                </td>
              </tr>
            ) : (
              filteredFiles.map(file => (
                <tr key={file.name} className="h-14 hover:bg-[#202124] transition-colors cursor-pointer group" onClick={() => handleFileClick(file)}>
                  <td className="px-6 py-3 font-medium text-white">
                    <div className="flex items-center gap-3">
                      {file.is_dir ? <Folder size={18} className="text-blue-400" /> : <FileIcon size={18} className="text-gray-400" />}
                      {file.name}
                    </div>
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
      {fileToDelete && (
        <ConfirmDialog
          title={`Delete ${fileToDelete.is_dir ? 'folder' : 'file'}?`}
          message={`${fileToDelete.name} will be permanently deleted${fileToDelete.is_dir ? ' with all contents' : ''}.`}
          confirmLabel="Delete"
          onCancel={() => setFileToDelete(null)}
          onConfirm={() => performDelete(fileToDelete)}
        />
      )}
      {createType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
          <form onSubmit={event => { event.preventDefault(); createEntry(); }} className="w-full max-w-md rounded-lg border border-[#2a2b2f] bg-[#1c1d21] shadow-xl">
            <div className="p-5">
              <h2 className="font-semibold text-white">Create {createType === 'file' ? 'text file' : 'folder'}</h2>
              <label className="mt-4 block text-sm text-gray-400">Name</label>
              <input
                autoFocus
                value={createName}
                onChange={event => setCreateName(event.target.value)}
                placeholder={createType === 'file' ? 'notes.txt' : 'plugins'}
                className="mt-2 w-full rounded-md border border-[#2a2b2f] bg-[#0f0f11] px-3 py-2 text-white outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-[#2a2b2f] bg-[#141517] p-4">
              <button type="button" onClick={() => { setCreateType(null); setCreateName(''); }} className="rounded-md bg-[#2a2b2f] px-4 py-2 text-sm text-white hover:bg-[#3a3b3f]">Cancel</button>
              <button type="submit" disabled={!createName.trim()} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">Create</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
