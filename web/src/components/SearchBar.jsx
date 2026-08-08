import { Search } from "lucide-react";

export default function SearchBar({ value, onChange }) {
  return (
    <div className="search-bar">
      <Search size={16} />
      <input
        placeholder="Search your agenda"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
import React from "react";
