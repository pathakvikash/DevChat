import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface WorkspaceState {
  isWorkspaceVisible: boolean;
}

const initialState: WorkspaceState = {
  isWorkspaceVisible: false,
};

const workspaceSlice = createSlice({
  name: 'workspace',
  initialState,
  reducers: {
    toggleWorkspace: (state) => {
      state.isWorkspaceVisible = !state.isWorkspaceVisible;
    },
  },
});

export const { toggleWorkspace } = workspaceSlice.actions;
export default workspaceSlice.reducer;
