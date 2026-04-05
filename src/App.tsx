import { NavLink, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Overview from "./pages/Overview";
import Behavior from "./pages/Behavior";
import Data from "./pages/Data";

const nav = [
  { to: "/", label: "Overview" },
  { to: "/behavior", label: "Behavior & post-loss" },
  { to: "/data", label: "Data & API" },
];

export default function App() {
  return (
    <Layout
      nav={
        <nav className="flex flex-wrap gap-2 border-b border-slate-800 pb-4">
          {nav.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                [
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition",
                  isActive
                    ? "bg-accent/20 text-accent"
                    : "text-slate-400 hover:bg-slate-800 hover:text-slate-200",
                ].join(" ")
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      }
    >
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/behavior" element={<Behavior />} />
        <Route path="/data" element={<Data />} />
      </Routes>
    </Layout>
  );
}
