import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Conversation } from '../../../entities/conversation.entity';
import { ConversationService } from './conversation.service';

/**
 * Unit tests for ConversationService. The TypeORM repository is
 * mocked; we do NOT spin up a real Postgres instance (the dev env
 * does not have one running). These tests cover the service's
 * business rules: ownership filtering, pagination math, default
 * title and the NotFoundException surface for cross-user ids.
 */
describe('ConversationService', () => {
  const userId = '11111111-1111-1111-1111-111111111111';
  const otherUserId = '22222222-2222-2222-2222-222222222222';
  const conversationId = '33333333-3333-3333-3333-333333333333';

  // Minimal stand-in for the TypeORM Repository<Conversation>.
  // We only stub the methods that ConversationService actually uses.
  const buildRepoMock = () => ({
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    remove: jest.fn(),
  });

  type RepoMock = ReturnType<typeof buildRepoMock>;

  let service: ConversationService;
  let repo: RepoMock;

  beforeEach(async () => {
    repo = buildRepoMock();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ConversationService,
        { provide: getRepositoryToken(Conversation), useValue: repo },
      ],
    }).compile();

    service = moduleRef.get(ConversationService);
  });

  describe('create', () => {
    it('persists a new conversation owned by the user', async () => {
      const created: Partial<Conversation> = {
        userId,
        title: '新会话',
      };
      const saved: Conversation = {
        id: conversationId,
        userId,
        title: '新会话',
        summary: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      };
      repo.create.mockReturnValue(created);
      repo.save.mockResolvedValue(saved);

      const result = await service.create(userId);

      expect(repo.create).toHaveBeenCalledWith({
        userId,
        title: '新会话',
      });
      expect(repo.save).toHaveBeenCalledWith(created);
      expect(result).toBe(saved);
    });

    it('uses the custom title when provided', async () => {
      const created: Partial<Conversation> = {
        userId,
        title: '我的会话',
      };
      repo.create.mockReturnValue(created);
      repo.save.mockResolvedValue({ ...created, id: conversationId } as Conversation);

      await service.create(userId, '我的会话');

      expect(repo.create).toHaveBeenCalledWith({
        userId,
        title: '我的会话',
      });
    });
  });

  describe('findByUser', () => {
    it('clamps limit to the documented maximum', async () => {
      repo.findAndCount.mockResolvedValue([[], 0]);

      await service.findByUser(userId, 1, 9999);

      // take should be 100, not 9999.
      const call = repo.findAndCount.mock.calls[0]?.[0] ?? {};
      expect(call.take).toBe(100);
      expect(call.skip).toBe(0);
      expect(call.order).toEqual({ updatedAt: 'DESC' });
      expect(call.where).toEqual({ userId });
    });

    it('computes skip from the page number', async () => {
      repo.findAndCount.mockResolvedValue([[], 0]);

      await service.findByUser(userId, 3, 20);

      const call = repo.findAndCount.mock.calls[0]?.[0] ?? {};
      expect(call.skip).toBe(40); // (3 - 1) * 20
      expect(call.take).toBe(20);
    });

    it('falls back to safe defaults on bogus input', async () => {
      repo.findAndCount.mockResolvedValue([[], 0]);

      // Bogus/negative values should be coerced to safe ones.
      // Page -5 → 1. Limit 0 is treated as "use the default of 20".
      const result = await service.findByUser(userId, -5, 0);

      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });
  });

  describe('findByIdAndUser', () => {
    it('returns the conversation when it belongs to the user', async () => {
      const conv = { id: conversationId, userId } as Conversation;
      repo.findOne.mockResolvedValue(conv);

      const result = await service.findByIdAndUser(conversationId, userId);

      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: conversationId, userId },
      });
      expect(result).toBe(conv);
    });

    it('returns null for cross-user access (no leak)', async () => {
      // The repository's where-clause already scopes by userId, so
      // an other-user conversation simply does not match.
      repo.findOne.mockResolvedValue(null);

      const result = await service.findByIdAndUser(
        conversationId,
        otherUserId,
      );

      expect(result).toBeNull();
    });

    it('returns null for an empty id', async () => {
      const result = await service.findByIdAndUser('', userId);
      expect(result).toBeNull();
      expect(repo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('updateTitle', () => {
    it('renames a conversation the user owns', async () => {
      const conv = {
        id: conversationId,
        userId,
        title: '旧标题',
      } as Conversation;
      // findByIdAndUser → findOne
      repo.findOne.mockResolvedValue(conv);
      repo.save.mockResolvedValue({ ...conv, title: '新标题' });

      const result = await service.updateTitle(
        conversationId,
        userId,
        '新标题',
      );

      expect(result.title).toBe('新标题');
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ title: '新标题' }),
      );
    });

    it('throws when the conversation does not exist for the user', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.updateTitle(conversationId, userId, 'whatever'),
      ).rejects.toThrow();
    });
  });

  describe('delete', () => {
    it('removes the conversation the user owns', async () => {
      const conv = { id: conversationId, userId } as Conversation;
      repo.findOne.mockResolvedValue(conv);
      repo.remove.mockResolvedValue(conv);

      await service.delete(conversationId, userId);

      expect(repo.remove).toHaveBeenCalledWith(conv);
    });

    it('throws when the conversation does not exist for the user', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.delete(conversationId, userId),
      ).rejects.toThrow();
      expect(repo.remove).not.toHaveBeenCalled();
    });
  });
});
