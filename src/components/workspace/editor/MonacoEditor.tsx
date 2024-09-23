import React, { useRef, useEffect } from 'react';
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';

// Load Monaco Editor from local files
loader.config({ monaco });

interface MonacoEditorProps {
  language: string;
  value: string;
  onChange: (value: string) => void;
  options?: monaco.editor.IStandaloneEditorConstructionOptions;
}

const MonacoEditor: React.FC<MonacoEditorProps> = ({
  language,
  value,
  onChange,
  options = {},
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const editorInstance = useRef<monaco.editor.IStandaloneCodeEditor | null>(
    null
  );

  useEffect(() => {
    if (editorRef.current) {
      editorInstance.current = monaco.editor.create(editorRef.current, {
        value,
        language,
        ...options,
      });

      editorInstance.current.onDidChangeModelContent(() => {
        onChange(editorInstance.current?.getValue() || '');
      });
    }

    return () => {
      editorInstance.current?.dispose();
    };
  }, []);

  useEffect(() => {
    if (editorInstance.current) {
      const model = editorInstance.current.getModel();
      if (model) {
        monaco.editor.setModelLanguage(model, language);
      }
    }
  }, [language]);

  useEffect(() => {
    if (editorInstance.current) {
      if (value !== editorInstance.current.getValue()) {
        editorInstance.current.setValue(value);
      }
    }
  }, [value]);

  return <div ref={editorRef} style={{ width: '100%', height: '60vh' }} />;
};

export default MonacoEditor;
