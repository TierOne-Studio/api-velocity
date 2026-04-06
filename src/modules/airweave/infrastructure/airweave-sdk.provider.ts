import { type Provider } from '@nestjs/common';
import { AirweaveSDKClient } from '@airweave/sdk';
import { ConfigService } from '../../../shared/config';

export const AIRWEAVE_SDK_CLIENT = Symbol('AIRWEAVE_SDK_CLIENT');

export type AirweaveSdkClient = AirweaveSDKClient | null;

export const airweaveSdkProvider: Provider = {
  provide: AIRWEAVE_SDK_CLIENT,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): AirweaveSdkClient => {
    const apiKey = configService.getAirweaveApiKey();

    if (!apiKey) {
      return null;
    }

    return new AirweaveSDKClient({
      apiKey,
      baseUrl: configService.getAirweaveBaseUrl(),
    });
  },
};
