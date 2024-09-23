'use client';
import React, { useState, useEffect } from 'react';
import { Terminal, Code, Globe } from 'lucide-react';
import dynamic from 'next/dynamic';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card';
import CodeEditor from '@/components/workspace/editor/CodeEditor';
import WebBrowser from '@/components/workspace/browser/WebBrowser';
import TerminalEmulator from '@/components/workspace/terminal/TerminalEmulator';

const DynamicTabs = dynamic(
  () => import('@/components/ui/Tabs').then((mod) => mod.Tabs),
  {
    ssr: false,
    loading: () => <p>Loading...</p>,
  }
);

const DynamicTabsList = dynamic(
  () => import('@/components/ui/Tabs').then((mod) => mod.TabsList),
  { ssr: false }
);
const DynamicTabsTrigger = dynamic(
  () => import('@/components/ui/Tabs').then((mod) => mod.TabsTrigger),
  { ssr: false }
);
const DynamicTabsContent = dynamic(
  () => import('@/components/ui/Tabs').then((mod) => mod.TabsContent),
  { ssr: false }
);

const Workspace = () => {
  const [activeTab, setActiveTab] = useState('code');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <Card className='w-full max-w-8xl mx-auto'>
      <CardHeader>
        <CardTitle>AI Agent Interface</CardTitle>
        <CardDescription>
          Simulate an AI agent's development environment
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DynamicTabs value={activeTab} onValueChange={setActiveTab}>
          <DynamicTabsList className='grid w-full grid-cols-3'>
            <DynamicTabsTrigger value='code'>
              <Code className='w-4 h-4 mr-2' />
              Code IDE
            </DynamicTabsTrigger>
            <DynamicTabsTrigger value='browser'>
              <Globe className='w-4 h-4 mr-2' />
              Web Browser
            </DynamicTabsTrigger>
            <DynamicTabsTrigger value='terminal'>
              <Terminal className='w-4 h-4 mr-2' />
              Terminal
            </DynamicTabsTrigger>
          </DynamicTabsList>
          <DynamicTabsContent value='code'>
            <CodeEditor />
          </DynamicTabsContent>
          <DynamicTabsContent value='browser'>
            <WebBrowser />
          </DynamicTabsContent>
          <DynamicTabsContent value='terminal'>
            <TerminalEmulator />
          </DynamicTabsContent>
        </DynamicTabs>
      </CardContent>
    </Card>
  );
};

export default Workspace;
