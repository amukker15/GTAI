import { useNavigate } from "react-router-dom";

export default function Phone() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-slate-900 text-center">
      <div>
        <h1 className="text-6xl font-extrabold tracking-tight text-slate-900 dark:text-white">phone</h1>
        <div className="mt-8">
          <button
            onClick={() => navigate('/')}
            className="rounded-md bg-slate-800 text-white px-4 py-2 text-sm font-semibold hover:bg-slate-900"
          >
            Back to dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
