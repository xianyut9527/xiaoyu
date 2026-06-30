import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';
import { AnalysisResult } from './analysis-result.entity';

/**
 * Strategy template types supported by the analysis pipeline.
 * Stored as varchar(50) so we can add new templates without
 * a schema migration, but constrained at the application layer
 * via this enum.
 */
export enum AnalysisTemplateType {
  Swot = 'swot',
  DecisionTree = 'decision_tree',
  ProsCons = 'pros_cons',
}

/**
 * The `analysis_requests` table captures a single invocation of
 * one of the analysis templates (SWOT, decision tree, pros/cons).
 * `input` holds the raw user query and any context as JSONB.
 */
@Entity({ name: 'analysis_requests' })
export class AnalysisRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 50 })
  templateType!: AnalysisTemplateType;

  @Column({ type: 'jsonb' })
  input!: Record<string, unknown>;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, (user) => user.analysisRequests, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'userId' })
  user?: User;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => AnalysisResult, (result) => result.request)
  results?: AnalysisResult[];
}
