// Copyright (c) 2026 Paul Langdon.
// All rights reserved.
// Proprietary software. See the repository README for terms.

import '@fontsource/rubik/latin-400.css';
import '@fontsource/rubik/latin-500.css';
import './admin.css';
import { render } from 'preact';
import { Dashboard } from './Dashboard';

render(<Dashboard />, document.getElementById('admin')!);
