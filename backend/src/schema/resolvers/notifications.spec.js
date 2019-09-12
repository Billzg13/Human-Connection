import Factory from '../../seed/factories'
import { gql } from '../../jest/helpers'
import { getDriver } from '../../bootstrap/neo4j'
import { createTestClient } from 'apollo-server-testing'
import createServer from '../.././server'

const factory = Factory()
const driver = getDriver()
let authenticatedUser
let user
let author
let variables
let query
let mutate

beforeAll(() => {
  const { server } = createServer({
    context: () => {
      return {
        driver,
        user: authenticatedUser,
      }
    },
  })
  query = createTestClient(server).query
  mutate = createTestClient(server).mutate
})

beforeEach(async () => {
  authenticatedUser = null
  variables = { orderBy: 'created_at_asc' }
})

afterEach(async () => {
  await factory.cleanDatabase()
})

describe('given some notifications', () => {
  beforeEach(async () => {
    const categoryIds = ['cat1']
    author = await factory.create('User', { id: 'author' })
    user = await factory.create('User', { id: 'you' })
    const [neighbor] = await Promise.all([
      factory.create('User', { id: 'neighbor' }),
      factory.create('Category', { id: 'cat1' }),
    ])
    const [post1, post2, post3] = await Promise.all([
      factory.create('Post', { author, id: 'p1', categoryIds, content: 'Not for you' }),
      factory.create('Post', {
        author,
        id: 'already-seen-post',
        title: 'Already seen post title',
        categoryIds,
        content: 'Already seen post mention',
      }),
      factory.create('Post', {
        author,
        id: 'have-been-mentioned',
        title: 'Have been mentioned',
        categoryIds,
        content: 'You have been mentioned in a post',
      }),
    ])
    const [comment1, comment2, comment3] = await Promise.all([
      factory.create('Comment', {
        author,
        postId: 'have-been-mentioned',
        id: 'c1',
        content: 'You have seen this comment mentioning already',
      }),
      factory.create('Comment', {
        author,
        postId: 'have-been-mentioned',
        id: 'c2',
        content: 'You have been mentioned in a comment',
      }),
      factory.create('Comment', {
        author,
        postId: 'have-been-mentioned',
        id: 'c3',
        content: 'Somebody else was mentioned in a comment',
      }),
    ])
    await Promise.all([
      post1.relateTo(neighbor, 'notified', {
        read: false,
        reason: 'mentioned_in_post',
      }),
      post2.relateTo(user, 'notified', {
        read: true,
        reason: 'mentioned_in_post',
      }),
      post3.relateTo(user, 'notified', {
        read: false,
        reason: 'mentioned_in_post',
      }),
      comment1.relateTo(user, 'notified', {
        read: true,
        reason: 'mentioned_in_comment',
      }),
      comment2.relateTo(user, 'notified', {
        read: false,
        reason: 'mentioned_in_comment',
      }),
      comment3.relateTo(neighbor, 'notified', {
        read: false,
        reason: 'mentioned_in_comment',
      }),
    ])
  })

  describe('notifications', () => {
    const notificationQuery = gql`
      query($read: Boolean, $orderBy: NotificationOrdering) {
        notifications(read: $read, orderBy: $orderBy) {
          from {
            __typename
            ... on Post {
              title
              content
            }
            ... on Comment {
              content
            }
          }
          read
          created_at {
            formatted
          }
        }
      }
    `
    describe('unauthenticated', () => {
      it('throws authorization error', async () => {
        const { errors } = await query({ query: notificationQuery })
        expect(errors[0]).toHaveProperty('message', 'Not Authorised!')
      })
    })

    describe('authenticated', () => {
      beforeEach(async () => {
        authenticatedUser = await user.toJson()
      })

      describe('no filters', () => {
        it('returns all notifications of current user', async () => {
          const expected = [
            {
              from: {
                __typename: 'Comment',
                content: 'You have seen this comment mentioning already',
              },
              read: true,
              created_at: { formatted: expect.any(String) },
            },
            {
              from: {
                __typename: 'Post',
                title: 'Already seen post title',
                content: 'Already seen post mention',
              },
              read: true,
              created_at: { formatted: expect.any(String) },
            },
            {
              from: {
                __typename: 'Comment',
                content: 'You have been mentioned in a comment',
              },
              read: false,
              created_at: { formatted: expect.any(String) },
            },
            {
              from: {
                __typename: 'Post',
                title: 'Have been mentioned',
                content: 'You have been mentioned in a post',
              },
              read: false,
              created_at: { formatted: expect.any(String) },
            },
          ]
          await expect(query({ query: notificationQuery, variables })).resolves.toMatchObject({
            data: {
              notifications: expect.arrayContaining(expected),
            },
          })
        })
      })

      describe('filter for read: false', () => {
        it('returns only unread notifications of current user', async () => {
          const expected = [
            {
              from: {
                __typename: 'Comment',
                content: 'You have been mentioned in a comment',
              },
              read: false,
              created_at: { formatted: expect.any(String) },
            },
            {
              from: {
                __typename: 'Post',
                title: 'Have been mentioned',
                content: 'You have been mentioned in a post',
              },
              read: false,
              created_at: { formatted: expect.any(String) },
            },
          ]
          await expect(
            query({ query: notificationQuery, variables: { ...variables, read: false } }),
          ).resolves.toEqual(
            expect.objectContaining({
              data: {
                notifications: expect.arrayContaining(expected),
              },
            }),
          )
        })

        describe('if a resource gets deleted', () => {
          const deletePostAction = async () => {
            authenticatedUser = await author.toJson()
            const deletePostMutation = gql`
              mutation($id: ID!) {
                DeletePost(id: $id) {
                  id
                  deleted
                }
              }
            `
            await expect(
              mutate({ mutation: deletePostMutation, variables: { id: 'have-been-mentioned' } }),
            ).resolves.toMatchObject({
              data: { DeletePost: { id: 'have-been-mentioned', deleted: true } },
            })
            authenticatedUser = await user.toJson()
          }

          it('reduces notifications list', async () => {
            await expect(
              query({ query: notificationQuery, variables: { ...variables, read: false } }),
            ).resolves.toMatchObject({
              data: { notifications: [expect.any(Object), expect.any(Object)] },
            })
            await deletePostAction()
            await expect(
              query({ query: notificationQuery, variables: { ...variables, read: false } }),
            ).resolves.toMatchObject({ data: { notifications: [] } })
          })
        })
      })
    })
  })

  describe('markAsRead', () => {
    const markAsReadMutation = gql`
      mutation($id: ID!) {
        markAsRead(id: $id) {
          from {
            __typename
            ... on Post {
              content
            }
            ... on Comment {
              content
            }
          }
          read
          created_at {
            formatted
          }
        }
      }
    `
    describe('unauthenticated', () => {
      it('throws authorization error', async () => {
        const result = await mutate({
          mutation: markAsReadMutation,
          variables: { ...variables, id: 'p1' },
        })
        expect(result.errors[0]).toHaveProperty('message', 'Not Authorised!')
      })
    })

    describe('authenticated', () => {
      beforeEach(async () => {
        authenticatedUser = await user.toJson()
      })

      describe('not being notified at all', () => {
        beforeEach(async () => {
          variables = {
            ...variables,
            id: 'p1',
          }
        })

        it('returns null', async () => {
          const response = await mutate({ mutation: markAsReadMutation, variables })
          expect(response.data.markAsRead).toEqual(null)
          expect(response.errors).toBeUndefined()
        })
      })

      describe('being notified', () => {
        describe('on a post', () => {
          beforeEach(async () => {
            variables = {
              ...variables,
              id: 'have-been-mentioned',
            }
          })

          it('updates `read` attribute and returns NOTIFIED relationship', async () => {
            const { data } = await mutate({ mutation: markAsReadMutation, variables })
            expect(data).toEqual({
              markAsRead: {
                from: {
                  __typename: 'Post',
                  content: 'You have been mentioned in a post',
                },
                read: true,
                created_at: { formatted: expect.any(String) },
              },
            })
          })

          describe('but notification was already marked as read', () => {
            beforeEach(async () => {
              variables = {
                ...variables,
                id: 'already-seen-post',
              }
            })
            it('returns null', async () => {
              const response = await mutate({ mutation: markAsReadMutation, variables })
              expect(response.data.markAsRead).toEqual(null)
              expect(response.errors).toBeUndefined()
            })
          })
        })

        describe('on a comment', () => {
          beforeEach(async () => {
            variables = {
              ...variables,
              id: 'c2',
            }
          })

          it('updates `read` attribute and returns NOTIFIED relationship', async () => {
            const { data } = await mutate({ mutation: markAsReadMutation, variables })
            expect(data).toEqual({
              markAsRead: {
                from: {
                  __typename: 'Comment',
                  content: 'You have been mentioned in a comment',
                },
                read: true,
                created_at: { formatted: expect.any(String) },
              },
            })
          })
        })
      })
    })
  })
})
