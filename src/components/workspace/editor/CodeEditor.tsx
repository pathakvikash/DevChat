'use client';
import { useState, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { X, Menu, File, Folder, Trash2, Edit2 } from 'lucide-react';

const MonacoEditor = dynamic(() => import('../editor/MonacoEditor'), {
  ssr: false,
  loading: () => <p>Loading editor...</p>,
});

interface File {
  name: string;
  content: string;
  language: string;
}
const CodeEditor = () => {
  const [files, setFiles] = useState<File[]>([
    {
      name: 'main.py',
      content: `def hello_world():\n    print('Hello, World!')\n\nhello_world()`,
      language: 'python',
    },
  ]);
  const [currentFile, setCurrentFile] = useState<File>(files[0]);
  const [output, setOutput] = useState('');
  const [newFileName, setNewFileName] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [editingFileName, setEditingFileName] = useState<string | null>(null);
  const editorRef = useRef(null);

  const executeCode = async () => {
    try {
      const response = await fetch('/api/execute-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: currentFile.content }),
      });
      const result = await response.json();
      if (result.error) {
        setOutput(`Error: ${result.error}`);
      } else {
        setOutput(result.output);
      }
    } catch (error: any) {
      setOutput(`Error: ${error.message}`);
    }
  };

  const addNewFile = () => {
    if (newFileName) {
      const newFile: File = {
        name: newFileName,
        content: '',
        language: 'python',
      };
      setFiles([...files, newFile]);
      setCurrentFile(newFile);
      setNewFileName('');
    }
  };

  const deleteFile = (fileName: string) => {
    if (files.length > 1) {
      const newFiles = files.filter((file) => file.name !== fileName);
      setFiles(newFiles);
      if (currentFile.name === fileName) {
        setCurrentFile(newFiles[0]);
      }
    }
  };

  const startEditingFileName = (fileName: string) => {
    setEditingFileName(fileName);
  };

  const finishEditingFileName = (oldName: string, newName: string) => {
    if (newName && newName !== oldName) {
      const updatedFiles = files.map((file) =>
        file.name === oldName ? { ...file, name: newName } : file
      );
      setFiles(updatedFiles);
      if (currentFile.name === oldName) {
        setCurrentFile({ ...currentFile, name: newName });
      }
    }
    setEditingFileName(null);
  };

  return (
    <div className='flex h-screen'>
      <div
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white shadow-lg transform ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } transition-transform duration-300 ease-in-out`}
      >
        <div className='p-4'>
          <Button onClick={() => setIsSidebarOpen(false)} className='mb-4'>
            <X size={20} />
          </Button>
          <div className='flex mb-4'>
            <Input
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              placeholder='New file name'
              className='mr-2'
            />
            <Button onClick={addNewFile}>
              <File size={16} />
            </Button>
          </div>
          <ul className='space-y-2'>
            {files.map((file) => (
              <li key={file.name} className='flex items-center justify-between'>
                {editingFileName === file.name ? (
                  <Input
                    value={file.name}
                    onChange={(e) =>
                      finishEditingFileName(file.name, e.target.value)
                    }
                    onBlur={() => setEditingFileName(null)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        finishEditingFileName(file.name, e.currentTarget.value);
                      }
                    }}
                    autoFocus
                  />
                ) : (
                  <span
                    onClick={() => setCurrentFile(file)}
                    className={`cursor-pointer ${
                      currentFile.name === file.name ? 'font-bold' : ''
                    }`}
                  >
                    {file.name}
                  </span>
                )}
                <div>
                  <Button
                    onClick={() => startEditingFileName(file.name)}
                    className='mr-1'
                  >
                    <Edit2 size={16} />
                  </Button>
                  <Button onClick={() => deleteFile(file.name)}>
                    <Trash2 size={16} />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className='flex-1 p-4'>
        <Button onClick={() => setIsSidebarOpen(true)} className='mb-4'>
          <Menu size={20} />
        </Button>
        <MonacoEditor
          language={currentFile.language}
          value={currentFile.content}
          onChange={(value) => {
            const updatedFile = { ...currentFile, content: value };
            setCurrentFile(updatedFile);
            setFiles(
              files.map((f) => (f.name === currentFile.name ? updatedFile : f))
            );
          }}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
          }}
        />
        <Button onClick={executeCode} className='mt-4'>
          Run Code
        </Button>
        <pre className='mt-4 p-4 bg-gray-200 rounded-md'>{output}</pre>
      </div>
    </div>
  );
};

export default CodeEditor;
