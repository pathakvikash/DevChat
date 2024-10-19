import React, { useEffect, useState } from 'react';

interface RoleSelectProps {
  roles: { [key: string]: string };
  selectedRole: string;
  onRoleSelect: (role: string) => void;
  setShowRoles: (show: boolean) => void;
}

const RoleSelect: React.FC<RoleSelectProps> = ({ roles, selectedRole, onRoleSelect, setShowRoles }) => {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const roleKeys = Object.keys(roles);

  const handleRoleSelect = (role: string) => {
    onRoleSelect(role);
    setShowRoles(false);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((prev) => (prev > 0 ? prev - 1 : roleKeys.length - 1));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((prev) => (prev < roleKeys.length - 1 ? prev + 1 : 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleRoleSelect(roleKeys[focusedIndex]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedIndex, roleKeys, onRoleSelect]);

  return (
    <div className="absolute bottom-full mb-2 bg-gray-700 rounded-lg p-2">
      {roleKeys.map((role, index) => (
        <div
          key={role}
          className={`cursor-pointer p-2 rounded ${selectedRole === role ? 'bg-blue-600' : 'hover:bg-gray-600'} ${focusedIndex === index ? 'outline outline-2 outline-white' : ''}`}
          onClick={() => handleRoleSelect(role)}
        >
          {role}
        </div>
      ))}
    </div>
  );
};

export default RoleSelect;