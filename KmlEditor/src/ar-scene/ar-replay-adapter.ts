import { GeoPosition } from '../contracts/type';
import { IEditorStore } from '../contracts/store';
import { ReplayHarness, IReplaySample } from '../editor/replay-harness';
import { ArAnchorCoordinator } from './ar-anchor-coordinator';

export class ArReplayAdapter {
    private readonly harness = new ReplayHarness();

    public constructor(
        private readonly anchorCoordinator: ArAnchorCoordinator,
        private readonly store: IEditorStore
    ) {
        this.harness.onSampleChange((sample) => this.processSample(sample));
    }

    public async loadRecording(zipBuffer: ArrayBuffer): Promise<number> {
        return await this.harness.loadZip(zipBuffer);
    }

    public loadSamples(samples: IReplaySample[]): void {
        this.harness.loadSamples(samples);
    }

    public play(): void {
        this.harness.play();
    }

    public pause(): void {
        this.harness.pause();
    }

    public step(): IReplaySample | null {
        return this.harness.step();
    }

    public getSampleCount(): number {
        return this.harness.getSamples().length;
    }

    public getCurrentIndex(): number {
        return this.harness.getCurrentIndex();
    }

    public dispose(): void {
        this.harness.dispose();
    }

    private processSample(sample: IReplaySample): void {
        const { lat, lon, alt } = sample.position;
        this.anchorCoordinator.updateGps(lat, lon, alt, 0, 3);
    }
}
