import { jest } from '@jest/globals';

jest.mock('@airweave/sdk', () => {
  return {
    AirweaveSDKClient: jest.fn().mockImplementation(() => ({ type: 'AirweaveSDKClient' })),
  };
});

import { airweaveSdkProvider, AIRWEAVE_SDK_CLIENT } from './airweave-sdk.provider';

describe('airweaveSdkProvider', () => {
  const mockConfigService = {
    getAirweaveApiKey: jest.fn<() => string | null>(),
    getAirweaveBaseUrl: jest.fn<() => string>(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exposes the AIRWEAVE_SDK_CLIENT token', () => {
    expect((airweaveSdkProvider as any).provide).toBe(AIRWEAVE_SDK_CLIENT);
  });

  it('returns null when apiKey is not configured', () => {
    mockConfigService.getAirweaveApiKey.mockReturnValue(null);

    const factory = (airweaveSdkProvider as any).useFactory as (cfg: typeof mockConfigService) => unknown;
    const result = factory(mockConfigService);

    expect(result).toBeNull();
  });

  it('instantiates and returns AirweaveSDKClient when apiKey is configured', () => {
    mockConfigService.getAirweaveApiKey.mockReturnValue('sk-test');
    mockConfigService.getAirweaveBaseUrl.mockReturnValue('https://api.airweave.ai');

    const factory = (airweaveSdkProvider as any).useFactory as (cfg: typeof mockConfigService) => unknown;
    const result = factory(mockConfigService);

    expect(result).not.toBeNull();
    expect(result).toBeTruthy();
  });
});
