import { useState, useEffect } from 'react';
import { fetchTags } from '../utils/api';

export const useTagManagement = () => {
  const [tags, setTags] = useState<string[]>([]);
  const [selectedTag, setSelectedTag] = useState<string>('');

  useEffect(() => {
    const fetchAvailableTags = async () => {
      try {
        const fetchedTags = await fetchTags();
        setTags(fetchedTags);
      } catch (error) {
        console.error('Error fetching tags:', error);
      }
    };

    fetchAvailableTags();
  }, []);

  return { tags, selectedTag, setSelectedTag };
};
