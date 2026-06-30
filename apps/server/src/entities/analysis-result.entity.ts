import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AnalysisRequest } from './analysis-request.entity';

/**
 * The `analysis_results` table stores the final, judged output
 * for a given analysis request. `providerOutputs` keeps the raw
 * outputs from every model in the ensemble so we can audit and
 * re-judge without re-running providers.
 */
@Entity({ name: 'analysis_results' })
export class AnalysisResult {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  content!: string;

  /**
   * `simple-json` is backed by `text` in PostgreSQL, with
   * TypeORM transparently serializing/deserializing JSON.
   * Nullable because not every flow needs to keep raw outputs.
   */
  @Column({ type: 'simple-json', nullable: true })
  providerOutputs!: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 50 })
  judgeModel!: string;

  @Index()
  @Column({ type: 'uuid' })
  requestId!: string;

  @ManyToOne(() => AnalysisRequest, (request) => request.results, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'requestId' })
  request?: AnalysisRequest;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
