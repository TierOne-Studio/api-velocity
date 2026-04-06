import 'reflect-metadata';
import { ROLES_KEY, Roles } from './roles.decorator';

describe('Roles decorator', () => {
  it('sets ROLES_KEY metadata with the provided role names', () => {
    class TestClass {
      @Roles('admin', 'manager')
      testMethod() {}
    }
    const metadata = Reflect.getMetadata(
      ROLES_KEY,
      TestClass.prototype.testMethod,
    );
    expect(metadata).toEqual(['admin', 'manager']);
  });

  it('sets empty roles array when called with no arguments', () => {
    class TestClass {
      @Roles()
      testMethod() {}
    }
    const metadata = Reflect.getMetadata(
      ROLES_KEY,
      TestClass.prototype.testMethod,
    );
    expect(metadata).toEqual([]);
  });

  it('sets a single role', () => {
    class TestClass {
      @Roles('superadmin')
      testMethod() {}
    }
    const metadata = Reflect.getMetadata(
      ROLES_KEY,
      TestClass.prototype.testMethod,
    );
    expect(metadata).toEqual(['superadmin']);
  });
});
