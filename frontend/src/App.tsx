import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'sonner';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { Library } from './pages/Library';
import { Setlists } from './pages/Setlists';
import { SetlistDetail } from './pages/SetlistDetail';
import { Settings } from './pages/Settings';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="library" element={<Library />} />
          <Route path="setlists" element={<Setlists />} />
          <Route path="setlists/:id" element={<SetlistDetail />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: {
            background: 'rgba(20, 24, 32, 0.92)',
            border: '1px solid rgba(255,255,255,0.08)',
            backdropFilter: 'blur(16px)',
            color: '#F0F4FF',
          },
        }}
        offset={96}
      />
    </BrowserRouter>
  );
}

export default App;
