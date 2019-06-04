import { config, shallowMount, createLocalVue } from '@vue/test-utils'
import PostSlug from './index.vue'
import Vuex from 'vuex'
import Styleguide from '@human-connection/styleguide'

const localVue = createLocalVue()

localVue.use(Vuex)
localVue.use(Styleguide)

config.stubs['no-ssr'] = '<span><slot /></span>'

describe('PostSlug', () => {
  let wrapper
  let Wrapper
  let store
  let mocks

  beforeEach(() => {
    store = new Vuex.Store({
      getters: {
        'auth/user': () => {
          return {}
        },
      },
    })
    mocks = {
      $t: jest.fn(),
      $filters: {
        truncate: a => a,
      },
      // If you mocking router, than don't use VueRouter with lacalVue: https://vue-test-utils.vuejs.org/guides/using-with-vue-router.html
      $router: {
        history: {
          push: jest.fn(),
        },
      },
      $toast: {
        success: jest.fn(),
        error: jest.fn(),
      },
      $apollo: {
        mutate: jest.fn().mockResolvedValue(),
        queries: {
          Post: {
            refetch: jest.fn(),
          },
        },
      },
    }
  })

  describe('shallowMount', () => {
    Wrapper = () => {
      return shallowMount(PostSlug, {
        store,
        mocks,
        localVue,
      })
    }

    beforeEach(jest.useFakeTimers)

    describe('test mixin "PostMutationHelpers"', () => {
      beforeEach(() => {
        wrapper = Wrapper()
        wrapper.setData({
          post: {
            id: 'p23',
            name: 'It is a post',
            author: {
              id: 'u1',
            },
          },
        })
      })

      describe('deletion of Post from Page by invoking "deletePostCallback(`page`)"', () => {
        beforeEach(() => {
          wrapper.vm.deletePostCallback('page')
        })

        describe('after timeout', () => {
          beforeEach(jest.runAllTimers)

          it('not emits "deletePost"', () => {
            expect(wrapper.emitted().deletePost).toBeFalsy()
          })

          it('does go to index (main) page', () => {
            expect(mocks.$router.history.push).toHaveBeenCalledTimes(1)
          })

          it('does call mutation', () => {
            expect(mocks.$apollo.mutate).toHaveBeenCalledTimes(1)
          })

          it('mutation is successful', () => {
            expect(mocks.$toast.success).toHaveBeenCalledTimes(1)
          })
        })
      })
    })

    describe('toggleDisable', () => {
      it('refetches Post when a toggleDisable event occurs', () => {
        wrapper = Wrapper()
        wrapper.vm.$root.$emit('toggleDisable')
        expect(mocks.$apollo.queries.Post.refetch).toHaveBeenCalledTimes(1)
      })
    })
  })
})
