import { AppShell } from '../components/app-shell';
import { runtimeInitialData } from '../lib/demo-data';

export default function HomePage() {
  return <AppShell initialData={runtimeInitialData} />;
}
