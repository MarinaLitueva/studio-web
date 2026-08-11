import * as React from '@theia/core/shared/react';
import { injectable } from '@theia/core/shared/inversify';
import {
    ScmHistoryGraphWidget
} from '@theia/scm/lib/browser/scm-history-graph-widget';
import {
    HistoryGraphEntry
} from '@theia/scm/lib/browser/scm-history-graph-model';
import { withHistorySubject } from './studio-scm-history-subject';

/**
 * VS Code's 1.95 Git built-in emits the commit title in `message`, while the
 * Theia 1.73 graph renders the newer `subject` field. Keep the compatibility
 * shim at the widget boundary and leave the upstream SCM provider untouched.
 */
@injectable()
export class StudioScmHistoryGraphWidget extends ScmHistoryGraphWidget {
    protected override renderRow(
        entry: HistoryGraphEntry,
        idx: number,
        svgWidth: number
    ): React.ReactElement {
        return super.renderRow(withHistorySubject(entry), idx, svgWidth);
    }
}
