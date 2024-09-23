import { useSelector, useDispatch } from 'react-redux';
import { toggleWorkspace } from '../store/slice/workspaceSlice';
import { RootState } from '../store/store';
import { useSwipeable } from 'react-swipeable';
import { useEffect } from 'react';

export const useWorkspaceVisibility = () => {
  const dispatch = useDispatch();
  const isWorkspaceVisible = useSelector(
    (state: RootState) => state.workspace.isWorkspaceVisible
  );

  const handlers = useSwipeable({
    onSwipedLeft: () => dispatch(toggleWorkspace()),
    onSwipedRight: () => dispatch(toggleWorkspace()),
    preventScrollOnSwipe: true,
    trackMouse: true,
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (isWorkspaceVisible) {
        window.history.pushState(null, '', '/workspace');
      } else {
        window.history.pushState(null, '', '/');
      }
    }
  }, [isWorkspaceVisible]);

  return { isWorkspaceVisible, handlers };
};
